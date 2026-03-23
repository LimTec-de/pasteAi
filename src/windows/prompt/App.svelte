<script lang="ts">
    import { emitTo } from '@tauri-apps/api/event';
    import { Window } from '@tauri-apps/api/window';
    import { onMount } from 'svelte';
    import { APP_EVENTS, type WindowReadyPayload } from '../../app/events';
    import { AppStore } from '../../domain/store';
    import { PromptRepository } from '../../domain/prompt-repository';
    import { SettingsRepository } from '../../domain/settings-repository';
    import type { PromptOption } from '../../domain/types';
    import WindowShell from '../../lib/ui/WindowShell.svelte';

    const settingsRepository = new SettingsRepository(new AppStore());
    const promptRepository = new PromptRepository(settingsRepository);

    let allPrompts: PromptOption[] = [];
    let statusMessage = 'Loading prompt modes...';
    $: statusMessage = allPrompts.length === 0
        ? 'No prompt modes are available yet.'
        : `${allPrompts.length} prompt modes ready to use.`;

    async function loadPrompts(): Promise<void> {
        await settingsRepository.reload();
        allPrompts = await promptRepository.getAllPrompts();
    }

    async function closePromptSelector(): Promise<void> {
        await emitTo('main', APP_EVENTS.PROMPT_CANCELLED);
        await Window.getCurrent().hide();
    }

    async function choosePrompt(prompt: PromptOption): Promise<void> {
        await emitTo('main', APP_EVENTS.PROMPT_SELECTED, prompt);
        await Window.getCurrent().hide();
    }

    function handlePromptKeydown(event: KeyboardEvent, prompt: PromptOption): void {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void choosePrompt(prompt);
        }
    }

    onMount(() => {
        let unlistenOpen: (() => void) | undefined;
        let unlistenCloseRequested: (() => void) | undefined;

        void (async () => {
            const currentWindow = Window.getCurrent();

            unlistenOpen = await currentWindow.listen(APP_EVENTS.PROMPT_OPEN, async () => {
                await loadPrompts();
            });
            unlistenCloseRequested = await currentWindow.onCloseRequested(async (event) => {
                event.preventDefault();
                await closePromptSelector();
            });

            const payload: WindowReadyPayload = { windowId: 'prompt' };
            await emitTo('main', APP_EVENTS.WINDOW_READY, payload);

            try {
                await settingsRepository.initialize();
                await promptRepository.initialize();
                await loadPrompts();
            } catch (error) {
                console.error('Failed to initialize prompt window:', error);
                statusMessage = 'Could not load prompt modes.';
            }
        })();

        return () => {
            unlistenOpen?.();
            unlistenCloseRequested?.();
        };
    });
</script>

<WindowShell
    title="Choose a Prompt"
    eyebrow="Quick pick"
    variant="focus"
    onClose={closePromptSelector}
>
    <main class="window-page page-scroll prompt-shell">
        <div class="prompt-shell__status" aria-live="polite">{statusMessage}</div>

        {#if allPrompts.length === 0}
            <div class="prompt-shell__empty">No prompts are available yet. Create some in pasteAI first.</div>
        {:else}
            <ul class="prompt-shell__list" aria-label="Available prompts">
                {#each allPrompts as prompt, index (prompt.id)}
                    <li>
                        <button
                            class="prompt-item fade-up"
                            style={`animation-delay: ${60 + index * 45}ms;`}
                            type="button"
                            on:click={() => void choosePrompt(prompt)}
                            on:keydown={(event) => handlePromptKeydown(event, prompt)}
                        >
                            <div class="prompt-item__topline">
                                <div class="prompt-item__title">{prompt.title}</div>
                                <span class={`chip ${prompt.id < 1000 ? 'chip--muted' : ''}`}>
                                    {prompt.id < 1000 ? 'Built-in' : 'Custom'}
                                </span>
                            </div>
                        </button>
                    </li>
                {/each}
            </ul>
        {/if}

        <div class="prompt-shell__footer">
            <p class="muted-copy">You can manage prompt titles and instructions in the dashboard.</p>
            <button class="app-button app-button--secondary" type="button" on:click={() => void closePromptSelector()}>Cancel</button>
        </div>
    </main>
</WindowShell>
