<script lang="ts">
    import { invoke } from '@tauri-apps/api/core';
    import { emitTo } from '@tauri-apps/api/event';
    import { Window } from '@tauri-apps/api/window';
    import { onMount, tick } from 'svelte';
    import { APP_EVENTS, type PromptOpenPayload, type WindowReadyPayload } from '../../app/events';
    import { AppStore } from '../../domain/store';
    import { PromptRepository } from '../../domain/prompt-repository';
    import { SettingsRepository } from '../../domain/settings-repository';
    import type { PromptChoice, PromptOption } from '../../domain/types';
    import WindowShell from '../../lib/ui/WindowShell.svelte';

    const settingsRepository = new SettingsRepository(new AppStore());
    const promptRepository = new PromptRepository(settingsRepository);

    let pickerMode: PromptOpenPayload['mode'] = 'full';
    let allPrompts: PromptOption[] = [];
    let selectedPromptId: number | null = null;
    let extraInstruction = '';
    let extraInput: HTMLInputElement | null = null;
    let statusMessage = 'Loading prompt modes...';
    $: statusMessage = allPrompts.length === 0
        ? 'No prompt modes are available yet.'
        : `${allPrompts.length} prompt modes ready to use.`;
    $: selectedPrompt = allPrompts.find((prompt) => prompt.id === selectedPromptId) ?? allPrompts[0] ?? null;
    $: shellTitle = pickerMode === 'extra' && selectedPrompt ? selectedPrompt.title : 'Choose a Prompt';
    $: shellEyebrow = pickerMode === 'extra' ? 'Additional instruction' : 'Quick pick';

    async function loadPrompts(payload?: PromptOpenPayload): Promise<void> {
        await settingsRepository.reload();
        allPrompts = await promptRepository.getAllPrompts();
        extraInstruction = '';
        pickerMode = payload?.mode ?? 'full';

        const preferredId = payload?.preselected?.id
            ?? (pickerMode === 'full' ? await promptRepository.getDefaultPromptId() : null);
        selectedPromptId = preferredId !== null && allPrompts.some((prompt) => prompt.id === preferredId)
            ? preferredId
            : allPrompts[0]?.id ?? null;

        await tick();
        extraInput?.focus();
    }

    async function hidePromptWindow(): Promise<void> {
        await Window.getCurrent().hide();
        await invoke('restore_frontmost_app').catch((error) => {
            console.warn('Could not restore frontmost app:', error);
        });
    }

    async function closePromptSelector(): Promise<void> {
        await emitTo('main', APP_EVENTS.PROMPT_CANCELLED);
        await hidePromptWindow();
    }

    async function confirmPrompt(prompt: PromptOption): Promise<void> {
        const payload: PromptChoice = {
            prompt,
            extraInstruction: extraInstruction.trim()
        };
        await emitTo('main', APP_EVENTS.PROMPT_SELECTED, payload);
        await hidePromptWindow();
    }

    function selectPrompt(prompt: PromptOption): void {
        selectedPromptId = prompt.id;
        extraInput?.focus();
    }

    function selectByOffset(offset: number): void {
        if (pickerMode !== 'full' || allPrompts.length === 0) {
            return;
        }

        const currentIndex = allPrompts.findIndex((prompt) => prompt.id === selectedPromptId);
        const nextIndex = currentIndex < 0
            ? 0
            : (currentIndex + offset + allPrompts.length) % allPrompts.length;
        selectedPromptId = allPrompts[nextIndex].id;
    }

    function handleWindowKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            void closePromptSelector();
            return;
        }

        if (pickerMode === 'full' && event.key === 'ArrowDown') {
            event.preventDefault();
            selectByOffset(1);
            return;
        }

        if (pickerMode === 'full' && event.key === 'ArrowUp') {
            event.preventDefault();
            selectByOffset(-1);
            return;
        }

        if (event.key === 'Enter' && selectedPrompt) {
            if (event.target instanceof HTMLButtonElement) {
                return;
            }

            event.preventDefault();
            void confirmPrompt(selectedPrompt);
        }
    }

    onMount(() => {
        let unlistenOpen: (() => void) | undefined;
        let unlistenCloseRequested: (() => void) | undefined;

        void (async () => {
            const currentWindow = Window.getCurrent();

            unlistenOpen = await currentWindow.listen<PromptOpenPayload>(APP_EVENTS.PROMPT_OPEN, async (event) => {
                await loadPrompts(event.payload);
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

<svelte:window on:keydown={handleWindowKeydown} />

<WindowShell
    title={shellTitle}
    eyebrow={shellEyebrow}
    variant="focus"
    onClose={closePromptSelector}
>
    <main class="window-page page-scroll prompt-shell" class:prompt-shell--extra={pickerMode === 'extra'}>
        {#if pickerMode === 'full'}
            <div class="prompt-shell__status" aria-live="polite">{statusMessage}</div>

            {#if allPrompts.length === 0}
                <div class="prompt-shell__empty">No prompts are available yet. Create some in pasteAI first.</div>
            {:else}
                <ul class="prompt-shell__list" aria-label="Available prompts">
                    {#each allPrompts as prompt, index (prompt.id)}
                        <li>
                            <button
                                class="prompt-item fade-up"
                                class:is-selected={prompt.id === selectedPromptId}
                                style={`animation-delay: ${60 + index * 45}ms;`}
                                type="button"
                                on:click={() => selectPrompt(prompt)}
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
        {/if}

        <label class="prompt-shell__extra">
            <span class="prompt-shell__extra-label">Additional instruction</span>
            <input
                bind:this={extraInput}
                bind:value={extraInstruction}
                type="text"
                placeholder="The issue is fixed, write a reply."
            >
        </label>

        <div class="prompt-shell__footer">
            {#if pickerMode === 'full'}
                <p class="muted-copy">Select a prompt, then Continue. Extra instruction is optional.</p>
            {:else}
                <p class="muted-copy">Leave empty to use the prompt as-is.</p>
            {/if}
            <div class="prompt-shell__actions">
                <button class="app-button app-button--secondary" type="button" on:click={() => void closePromptSelector()}>Cancel</button>
                <button
                    class="app-button app-button--primary"
                    type="button"
                    disabled={!selectedPrompt}
                    on:click={() => selectedPrompt && void confirmPrompt(selectedPrompt)}
                >
                    Continue
                    <kbd class="prompt-shell__shortcut">Enter</kbd>
                </button>
            </div>
        </div>
    </main>
</WindowShell>
