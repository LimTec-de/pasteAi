<script lang="ts">
    import { emitTo } from '@tauri-apps/api/event';
    import { Window } from '@tauri-apps/api/window';
    import clipboard from 'tauri-plugin-clipboard-api';
    import { onMount, tick } from 'svelte';
    import { APP_EVENTS, type AnswerDisplayPayload, type WindowReadyPayload } from '../../app/events';
    import WindowShell from '../../lib/ui/WindowShell.svelte';

    let answerText = '';
    let textareaElement: HTMLTextAreaElement | null = null;

    async function show(payload: AnswerDisplayPayload): Promise<void> {
        answerText = payload.text;
        await tick();
        textareaElement?.focus();
        textareaElement?.select();
    }

    async function hide(): Promise<void> {
        await Window.getCurrent().hide();
    }

    async function copyAndClose(): Promise<void> {
        if (answerText.length > 0) {
            await clipboard.writeText(answerText);
        }
        await hide();
    }

    function handleCopyEvent(): void {
        void hide();
    }

    onMount(() => {
        let unlistenShow: (() => void) | undefined;

        void (async () => {
            const currentWindow = Window.getCurrent();

            unlistenShow = await currentWindow.listen<AnswerDisplayPayload>(APP_EVENTS.ANSWER_SHOW, (event) => {
                void show(event.payload);
            });

            const payload: WindowReadyPayload = { windowId: 'answer' };
            await emitTo('main', APP_EVENTS.WINDOW_READY, payload);
        })();

        document.addEventListener('copy', handleCopyEvent);

        return () => {
            unlistenShow?.();
            document.removeEventListener('copy', handleCopyEvent);
        };
    });
</script>

<WindowShell
    title="Your result"
    eyebrow="pasteAI"
    variant="focus"
    onClose={hide}
>
    <main class="window-page">
        <div class="answer-shell">
            <p class="answer-shell__hint">Edit the text if you like, then copy it. The window closes once you copy.</p>
            <textarea
                class="answer-shell__textarea"
                bind:this={textareaElement}
                bind:value={answerText}
                spellcheck="false"
            ></textarea>
            <div class="answer-shell__footer">
                <button class="app-button app-button--secondary" type="button" on:click={() => void hide()}>Close</button>
                <button class="app-button app-button--primary" type="button" on:click={() => void copyAndClose()}>Copy</button>
            </div>
        </div>
    </main>
</WindowShell>
