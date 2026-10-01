<script lang="ts">
    import { emitTo, listen } from '@tauri-apps/api/event';
    import { Window } from '@tauri-apps/api/window';
    import { error as logError, info } from '@tauri-apps/plugin-log';
    import { onMount, tick } from 'svelte';
    import {
        APP_EVENTS,
        type DictateCommitPayload,
        type DictateOpenPayload,
        type DictateSessionPayload,
        type WindowReadyPayload
    } from '../../app/events';
    import { cancelAppleDictation, stopAppleDictation } from '../../domain/apple-system';
    import { transcribeLocalStt } from '../../domain/local-stt';
    import { dictateAudioGraph, LiveTranscriptionSession, MicrophoneCapture, TranscriptionError } from '../../features/live-transcription';
    import { formatAcceleratorForDisplay } from '../../platform/shortcut';
    import WindowShell from '../../lib/ui/WindowShell.svelte';

    type DictatePhase = 'connecting' | 'recording' | 'converting';

    let session: LiveTranscriptionSession | null = null;
    let capture: MicrophoneCapture | null = null;
    let unlistenLevel: (() => void) | undefined;
    let openPayload: DictateOpenPayload | null = null;
    let engine: DictateOpenPayload['engine'] = 'openai';
    let outputMode: DictateOpenPayload['outputMode'] = 'insert';
    let committedByItem = new Map<string, string>();
    let committedOrder: string[] = [];
    let partialByItem = new Map<string, string>();
    let phase: DictatePhase = 'connecting';
    let receiving = false;
    let level = 0;
    let shortcutLabel = '';
    let latched = false;
    let statusMessage = 'Starting…';
    let errorMessage = '';
    let finishing = false;
    let openedAt = 0;
    let retryRecording: Float32Array[] | null = null;
    let hideGeneration = 0;

    $: committedText = committedOrder
        .map((itemId) => committedByItem.get(itemId) ?? '')
        .filter((part) => part.trim().length > 0)
        .join(' ');
    $: partialText = Array.from(partialByItem.values()).join(' ');
    $: displayText = [committedText, partialText].filter((part) => part.length > 0).join(' ');
    $: holdLine = shortcutLabel ? `Hold ${shortcutLabel} and speak.` : 'Hold the shortcut and speak.';
    $: actionLine = latched
        ? (outputMode === 'clipboard' ? 'Click Done to copy to clipboard.' : 'Click Done to insert and copy to clipboard.')
        : (outputMode === 'clipboard' ? 'Release to copy to clipboard.' : 'Release to insert and copy to clipboard.');
    $: meterClass = [
        phase === 'connecting' ? 'is-connecting' : '',
        phase === 'recording' && receiving ? 'is-receiving' : '',
        phase === 'converting' ? 'is-converting' : ''
    ].filter((part) => part.length > 0).join(' ');

    function resetTranscript(): void {
        committedByItem = new Map();
        committedOrder = [];
        partialByItem = new Map();
        phase = 'connecting';
        receiving = false;
        level = 0;
        latched = false;
        errorMessage = '';
        finishing = false;
        statusMessage = 'Starting…';
    }

    function applyLevel(nextLevel: number): void {
        if (phase !== 'recording') {
            return;
        }

        level = nextLevel;
        receiving = nextLevel > 0.06;
    }

    function createOpenAiSession(): LiveTranscriptionSession {
        return new LiveTranscriptionSession({
            onDelta(itemId, delta) {
                if (!committedOrder.includes(itemId)) {
                    committedOrder = [...committedOrder, itemId];
                }
                const current = partialByItem.get(itemId) ?? '';
                partialByItem = new Map(partialByItem).set(itemId, current + delta);
            },
            onCompleted(itemId, transcript) {
                if (!committedOrder.includes(itemId)) {
                    committedOrder = [...committedOrder, itemId];
                }
                committedByItem = new Map(committedByItem).set(itemId, transcript);
                const nextPartial = new Map(partialByItem);
                nextPartial.delete(itemId);
                partialByItem = nextPartial;
            },
            onLevel(nextLevel) {
                applyLevel(nextLevel);
            },
            onError(message) {
                errorMessage = message;
                statusMessage = 'Dictation failed';
            }
        });
    }

    async function startSession(payload: DictateOpenPayload): Promise<void> {
        stopSession();
        resetTranscript();
        openedAt = performance.now();
        retryRecording = null;
        openPayload = payload;
        engine = payload.engine;
        outputMode = payload.outputMode;
        shortcutLabel = formatAcceleratorForDisplay(payload.shortcut);

        if (engine === 'apple') {
            unlistenLevel = await listen<{ level: number }>('apple-dictate-level', (event) => {
                applyLevel(event.payload.level);
            });
            return;
        }

        if (engine === 'local') {
            const nextCapture = new MicrophoneCapture((nextLevel) => {
                applyLevel(nextLevel);
            });
            capture = nextCapture;
            try {
                await nextCapture.start(payload.microphoneId || undefined);
                if (capture === nextCapture) {
                    markReady();
                }
            } catch (error) {
                errorMessage = error instanceof Error ? error.message : String(error);
                statusMessage = 'Could not start microphone';
                stopSession();
            }
            return;
        }

        const nextSession = createOpenAiSession();
        session = nextSession;

        try {
            await nextSession.startMic({ microphoneId: payload.microphoneId || undefined });
            if (session !== nextSession) {
                return;
            }

            markReady();
            if (payload.clientSecret) {
                await attachOpenAiSecret(payload.clientSecret);
            }
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : String(error);
            statusMessage = 'Could not start microphone';
            stopSession();
        }
    }

    async function attachOpenAiSecret(clientSecret: string): Promise<void> {
        const payload = openPayload;
        const nextSession = session;
        if (!payload || !nextSession) {
            return;
        }

        try {
            await nextSession.connect(clientSecret, {
                languages: payload.languages,
                keywords: payload.keywords,
                prompt: payload.transcriptionPrompt
            });
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : String(error);
            statusMessage = 'Dictation failed';
            stopSession();
        }
    }

    function markReady(): void {
        if (errorMessage || phase === 'converting') {
            return;
        }

        void info(`[dictate] ${engine} recording ${Math.round(performance.now() - openedAt)}ms after overlay open`);
        phase = 'recording';
        statusMessage = 'Recording started';
    }

    function beginConvert(): void {
        finishing = true;
        phase = 'converting';
        statusMessage = 'Transcribing…';
        receiving = false;
        level = 0;
    }

    function stopSession(): void {
        unlistenLevel?.();
        unlistenLevel = undefined;
        session?.stop();
        session = null;
        capture?.stop();
        capture = null;
        receiving = false;
        level = 0;
    }

    async function hideWindow(): Promise<void> {
        await Window.getCurrent().hide();
    }

    async function commit(): Promise<void> {
        if (finishing) {
            return;
        }

        beginConvert();

        if (engine === 'local') {
            const recorded = capture?.takePcm16();
            stopSession();
            try {
                const text = recorded && recorded.pcm.length > 0
                    ? (await transcribeLocalStt(recorded.pcm, recorded.sampleRate)).trim()
                    : '';
                const payload: DictateCommitPayload = { text };
                await emitTo('main', APP_EVENTS.DICTATE_COMMIT, payload);
            } catch (error) {
                const payload: DictateCommitPayload = {
                    text: '',
                    error: error instanceof Error ? error.message : String(error)
                };
                await emitTo('main', APP_EVENTS.DICTATE_COMMIT, payload);
            }
            return;
        }

        if (engine === 'apple') {
            try {
                const text = (await stopAppleDictation()).trim();
                stopSession();
                const payload: DictateCommitPayload = { text };
                await emitTo('main', APP_EVENTS.DICTATE_COMMIT, payload);
            } catch (error) {
                stopSession();
                const payload: DictateCommitPayload = {
                    text: '',
                    error: error instanceof Error ? error.message : String(error)
                };
                await emitTo('main', APP_EVENTS.DICTATE_COMMIT, payload);
            }
            return;
        }

        await finishOpenAi();
    }

    async function finishOpenAi(): Promise<void> {
        const activeSession = session;
        const generation = hideGeneration;
        try {
            if (activeSession && !activeSession.isConnected()) {
                await activeSession.waitUntilConnected();
            }
            await activeSession?.commitAndWait();
        } catch (error) {
            if (generation !== hideGeneration) {
                return;
            }

            const recording = activeSession?.recordedAudio() ?? [];
            retryRecording = recording.length > 0 ? recording : null;
            stopSession();
            const payload: DictateCommitPayload = {
                text: '',
                error: error instanceof Error ? error.message : String(error),
                errorDetail: error instanceof TranscriptionError ? error.detail : undefined,
                retryable: retryRecording !== null
            };
            void logError(`[dictate] ${payload.error}${payload.errorDetail ? `: ${payload.errorDetail}` : ''}`);
            await emitTo('main', APP_EVENTS.DICTATE_COMMIT, payload);
            return;
        }

        retryRecording = null;
        await tick();
        const text = displayText.trim();
        stopSession();
        const payload: DictateCommitPayload = { text };
        await emitTo('main', APP_EVENTS.DICTATE_COMMIT, payload);
    }

    async function retryTranscription(): Promise<void> {
        const recording = retryRecording;
        if (!recording) {
            const payload: DictateCommitPayload = { text: '', error: 'The recording is no longer available' };
            await emitTo('main', APP_EVENTS.DICTATE_COMMIT, payload);
            return;
        }

        stopSession();
        resetTranscript();
        beginConvert();
        const replay = createOpenAiSession();
        replay.loadRecording(recording);
        session = replay;
        await finishOpenAi();
    }

    async function cancel(): Promise<void> {
        if (finishing) {
            return;
        }

        finishing = true;
        if (engine === 'apple') {
            await cancelAppleDictation().catch(() => undefined);
        }
        stopSession();
        await emitTo('main', APP_EVENTS.DICTATE_CANCEL);
        await hideWindow();
    }

    function handleWindowKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            void cancel();
        }
    }

    onMount(() => {
        let unlistenOpen: (() => void) | undefined;
        let unlistenSession: (() => void) | undefined;
        let unlistenReady: (() => void) | undefined;
        let unlistenHide: (() => void) | undefined;
        let unlistenLatch: (() => void) | undefined;
        let unlistenFinish: (() => void) | undefined;
        let unlistenRetry: (() => void) | undefined;
        let unlistenCloseRequested: (() => void) | undefined;

        void dictateAudioGraph.prewarm().catch((error) => {
            console.warn('Could not prewarm dictate audio graph:', error);
        });

        void (async () => {
            const currentWindow = Window.getCurrent();

            unlistenOpen = await currentWindow.listen<DictateOpenPayload>(APP_EVENTS.DICTATE_OPEN, (event) => {
                void startSession(event.payload);
            });
            unlistenSession = await currentWindow.listen<DictateSessionPayload>(APP_EVENTS.DICTATE_SESSION, (event) => {
                void attachOpenAiSecret(event.payload.clientSecret);
            });
            unlistenReady = await currentWindow.listen(APP_EVENTS.DICTATE_READY, () => {
                if (engine === 'apple') {
                    markReady();
                }
            });
            unlistenHide = await currentWindow.listen(APP_EVENTS.DICTATE_HIDE, () => {
                hideGeneration += 1;
                stopSession();
            });
            unlistenLatch = await currentWindow.listen(APP_EVENTS.DICTATE_LATCH, () => {
                latched = true;
                if (phase === 'recording' && !errorMessage) {
                    statusMessage = 'Recording started';
                }
            });
            unlistenFinish = await currentWindow.listen(APP_EVENTS.DICTATE_FINISH, () => {
                void commit();
            });
            unlistenRetry = await currentWindow.listen(APP_EVENTS.DICTATE_RETRY, () => {
                void retryTranscription();
            });
            unlistenCloseRequested = await currentWindow.onCloseRequested(async (event) => {
                event.preventDefault();
                await cancel();
            });

            const payload: WindowReadyPayload = { windowId: 'dictate' };
            await emitTo('main', APP_EVENTS.WINDOW_READY, payload);
        })();

        window.addEventListener('keydown', handleWindowKeydown);

        return () => {
            unlistenOpen?.();
            unlistenSession?.();
            unlistenReady?.();
            unlistenHide?.();
            unlistenLatch?.();
            unlistenFinish?.();
            unlistenRetry?.();
            unlistenCloseRequested?.();
            window.removeEventListener('keydown', handleWindowKeydown);
            stopSession();
        };
    });
</script>

<WindowShell
    title="Dictate"
    eyebrow={outputMode === 'clipboard' ? 'Hold to copy' : 'Hold to insert'}
    variant="focus"
    onClose={cancel}
>
    <main class="window-page dictate-shell">
        <div class={`dictate-meter ${meterClass}`} aria-hidden="true">
            <span
                class="dictate-meter__pulse"
                style={phase === 'recording' ? `transform: scale(${0.65 + (level * 0.7)})` : ''}
            ></span>
            <span class="dictate-meter__ring"></span>
            <span class="dictate-meter__core"></span>
        </div>

        <p class="dictate-status">{errorMessage || statusMessage}</p>
        <p class="dictate-hint">{holdLine}</p>
        <p class="dictate-hint">{actionLine}</p>
        {#if !errorMessage}
            <p class="dictate-learn">Correct a word after insert, then copy the text once. pasteAI can offer to save that spelling as a dictionary rule.</p>
        {/if}

        <div class="dictate-footer">
            <button class="app-button app-button--secondary" type="button" on:click={() => void cancel()}>Cancel</button>
            {#if latched && phase !== 'converting'}
                <button class="app-button app-button--primary" type="button" on:click={() => void commit()}>Done</button>
            {/if}
        </div>
    </main>
</WindowShell>
