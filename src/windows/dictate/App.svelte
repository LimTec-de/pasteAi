<script lang="ts">
    import { emitTo } from '@tauri-apps/api/event';
    import { Window } from '@tauri-apps/api/window';
    import { onMount, tick } from 'svelte';
    import { APP_EVENTS, type DictateCommitPayload, type DictateOpenPayload, type WindowReadyPayload } from '../../app/events';
    import { LiveTranscriptionSession } from '../../features/live-transcription';
    import { formatAcceleratorForDisplay } from '../../platform/shortcut';
    import WindowShell from '../../lib/ui/WindowShell.svelte';

    let session: LiveTranscriptionSession | null = null;
    let committedByItem = new Map<string, string>();
    let committedOrder: string[] = [];
    let partialByItem = new Map<string, string>();
    let receiving = false;
    let level = 0;
    let shortcutLabel = '';
    let latched = false;
    let statusMessage = 'Starting microphone…';
    let errorMessage = '';
    let finishing = false;

    $: committedText = committedOrder
        .map((itemId) => committedByItem.get(itemId) ?? '')
        .filter((part) => part.trim().length > 0)
        .join(' ');
    $: partialText = Array.from(partialByItem.values()).join(' ');
    $: displayText = [committedText, partialText].filter((part) => part.length > 0).join(' ');
    $: holdLine = shortcutLabel ? `Hold ${shortcutLabel} and speak.` : 'Hold the shortcut and speak.';
    $: actionLine = latched
        ? 'Click Done to insert and copy to clipboard.'
        : 'Release to insert and copy to clipboard.';

    function resetTranscript(): void {
        committedByItem = new Map();
        committedOrder = [];
        partialByItem = new Map();
        receiving = false;
        level = 0;
        latched = false;
        errorMessage = '';
        finishing = false;
    }

    async function startSession(clientSecret: string, shortcut: string): Promise<void> {
        stopSession();
        resetTranscript();
        shortcutLabel = formatAcceleratorForDisplay(shortcut);
        statusMessage = 'Recording started';

        const nextSession = new LiveTranscriptionSession({
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
                level = nextLevel;
                receiving = nextLevel > 0.06;
            },
            onError(message) {
                errorMessage = message;
                statusMessage = 'Dictation failed';
            }
        });

        session = nextSession;

        try {
            await nextSession.start(clientSecret);
            if (session === nextSession) {
                statusMessage = 'Recording started';
            }
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : String(error);
            statusMessage = 'Could not start microphone';
            stopSession();
        }
    }

    function stopSession(): void {
        session?.stop();
        session = null;
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

        finishing = true;
        await hideWindow();

        try {
            await session?.commitAndWait();
        } catch (error) {
            stopSession();
            const payload: DictateCommitPayload = {
                text: '',
                error: error instanceof Error ? error.message : String(error)
            };
            await emitTo('main', APP_EVENTS.DICTATE_COMMIT, payload);
            return;
        }

        await tick();
        const text = displayText.trim();
        stopSession();
        const payload: DictateCommitPayload = { text };
        await emitTo('main', APP_EVENTS.DICTATE_COMMIT, payload);
    }

    async function cancel(): Promise<void> {
        if (finishing) {
            return;
        }

        finishing = true;
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
        let unlistenHide: (() => void) | undefined;
        let unlistenLatch: (() => void) | undefined;
        let unlistenFinish: (() => void) | undefined;
        let unlistenCloseRequested: (() => void) | undefined;

        void (async () => {
            const currentWindow = Window.getCurrent();

            unlistenOpen = await currentWindow.listen<DictateOpenPayload>(APP_EVENTS.DICTATE_OPEN, (event) => {
                void startSession(event.payload.clientSecret, event.payload.shortcut);
            });
            unlistenHide = await currentWindow.listen(APP_EVENTS.DICTATE_HIDE, () => {
                stopSession();
            });
            unlistenLatch = await currentWindow.listen(APP_EVENTS.DICTATE_LATCH, () => {
                latched = true;
                statusMessage = 'Recording started';
            });
            unlistenFinish = await currentWindow.listen(APP_EVENTS.DICTATE_FINISH, () => {
                void commit();
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
            unlistenHide?.();
            unlistenLatch?.();
            unlistenFinish?.();
            unlistenCloseRequested?.();
            window.removeEventListener('keydown', handleWindowKeydown);
            stopSession();
        };
    });
</script>

<WindowShell
    title="Dictate"
    eyebrow="Hold to insert"
    variant="focus"
    onClose={cancel}
>
    <main class="window-page dictate-shell">
        <div class={`dictate-meter ${receiving ? 'is-receiving' : ''}`} aria-hidden="true">
            <span class="dictate-meter__pulse" style={`transform: scale(${0.65 + (level * 0.7)})`}></span>
            <span class="dictate-meter__core"></span>
        </div>

        <p class="dictate-status">{errorMessage || statusMessage}</p>
        <p class="dictate-hint">{holdLine}</p>
        <p class="dictate-hint">{actionLine}</p>

        <div class="dictate-footer">
            <button class="app-button app-button--secondary" type="button" on:click={() => void cancel()}>Cancel</button>
            {#if latched}
                <button class="app-button app-button--primary" type="button" on:click={() => void commit()}>Done</button>
            {/if}
        </div>
    </main>
</WindowShell>
