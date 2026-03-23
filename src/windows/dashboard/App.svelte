<script lang="ts">
    import { emitTo } from '@tauri-apps/api/event';
    import { getVersion } from '@tauri-apps/api/app';
    import { Window } from '@tauri-apps/api/window';
    import { onMount } from 'svelte';
    import { APP_EVENTS, type DashboardOpenPayload, type WindowReadyPayload } from '../../app/events';
    import { AppStore } from '../../domain/store';
    import { PromptRepository } from '../../domain/prompt-repository';
    import { DEFAULT_SETTINGS, SettingsRepository } from '../../domain/settings-repository';
    import { ProviderGateway } from '../../domain/provider-gateway';
    import type { AppSettings, DashboardSection, PromptOption, ProviderId } from '../../domain/types';
    import WindowShell from '../../lib/ui/WindowShell.svelte';

    const settingsRepository = new SettingsRepository(new AppStore());
    const promptRepository = new PromptRepository(settingsRepository);
    const providerGateway = new ProviderGateway(settingsRepository);

    let activeSection: DashboardSection = 'providers';
    let settings: AppSettings = { ...DEFAULT_SETTINGS };
    let prompts: PromptOption[] = [];
    let selectedPromptId: number | null = null;
    let defaultPromptId: number | null = null;

    let promptEditorVisible = false;
    let editingPromptId: number | null = null;
    let previousSelectedPromptId: number | null = null;
    let promptTitle = '';
    let promptText = '';
    let promptEditorError = '';

    let quotaMessage = '';
    let quotaIsError = false;
    let loginMessage = '';
    let loginIsError = false;
    let pasteAILinkedEmail: string | null = null;

    let ollamaAvailable = true;
    let ollamaModels: string[] = [];

    let version = 'Loading version...';
    let welcomeSectionElement: HTMLElement | null = null;
    let providersSectionElement: HTMLElement | null = null;
    let promptsSectionElement: HTMLElement | null = null;
    let aboutSectionElement: HTMLElement | null = null;

    $: selectedPrompt = prompts.find((prompt) => prompt.id === selectedPromptId) ?? null;
    $: selectedPromptIsBuiltIn = selectedPrompt ? selectedPrompt.id < 1000 : false;
    $: selectedPromptIsDefault = selectedPrompt ? selectedPrompt.id === defaultPromptId : false;
    $: showPromptPreview = !!selectedPrompt && !(promptEditorVisible && editingPromptId === null);
    $: showPromptEmptyState = !selectedPrompt && !(promptEditorVisible && editingPromptId === null);

    function setActiveSection(section: DashboardSection): void {
        activeSection = section;
        scrollActiveSectionToTop(section);
        if (section === 'providers') {
            void refreshProviderState();
        }
    }

    function scrollActiveSectionToTop(section: DashboardSection): void {
        const sectionElement = getSectionElement(section);
        sectionElement?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    function getSectionElement(section: DashboardSection): HTMLElement | null {
        switch (section) {
            case 'welcome':
                return welcomeSectionElement;
            case 'providers':
                return providersSectionElement;
            case 'prompts':
                return promptsSectionElement;
            case 'about':
                return aboutSectionElement;
        }
    }

    async function initializeDashboard(): Promise<void> {
        await settingsRepository.initialize();
        await promptRepository.initialize();
        settings = await settingsRepository.getAll();
        version = `Version ${await getVersion()}`;

        await refreshPromptState();
        await refreshProviderState();
    }

    async function refreshPromptState(preferredPromptId?: number | null): Promise<void> {
        prompts = await promptRepository.getAllPrompts();
        defaultPromptId = await promptRepository.getDefaultPromptId();

        const availableIds = prompts.map((prompt) => prompt.id);
        const nextSelection = preferredPromptId
            ?? selectedPromptId
            ?? defaultPromptId
            ?? prompts[0]?.id
            ?? null;

        selectedPromptId = nextSelection !== null && availableIds.includes(nextSelection)
            ? nextSelection
            : prompts[0]?.id ?? null;
    }

    async function refreshProviderState(): Promise<void> {
        if (settings.llmType === 'pasteai') {
            await loadPasteAIQuota();
            ollamaAvailable = true;
            ollamaModels = [];
            return;
        }

        quotaMessage = '';
        loginMessage = '';
        pasteAILinkedEmail = null;

        if (settings.llmType === 'ollama') {
            await refreshOllamaStatus();
            return;
        }

        ollamaAvailable = true;
        ollamaModels = [];
    }

    async function loadPasteAIQuota(): Promise<void> {
        try {
            const quota = await providerGateway.checkPasteAIQuota();
            pasteAILinkedEmail = quota.email;
            quotaMessage = `Balance: ${quota.balance}${quota.email ? '' : ' free'} tokens`;
            quotaIsError = false;

            if (quota.email && quota.email !== settings.email) {
                settings = { ...settings, email: quota.email };
                await settingsRepository.update({ email: quota.email });
                await emitTo('main', APP_EVENTS.SETTINGS_CHANGED);
            }

            if (quota.email) {
                loginMessage = `Logged in via ${quota.email}`;
                loginIsError = false;
            } else {
                loginMessage = '';
            }
        } catch (error) {
            console.error('Error checking quota:', error);
            quotaMessage = 'Error checking quota';
            quotaIsError = true;
        }
    }

    async function refreshOllamaStatus(): Promise<void> {
        ollamaAvailable = await providerGateway.checkOllamaAvailability(settings.ollamaUrl);
        if (!ollamaAvailable) {
            ollamaModels = [];
            return;
        }

        ollamaModels = await providerGateway.fetchOllamaModels(settings.ollamaUrl);
        if (settings.ollamaModel && !ollamaModels.includes(settings.ollamaModel)) {
            settings = { ...settings, ollamaModel: '' };
            await settingsRepository.update({ ollamaModel: '' });
            await emitTo('main', APP_EVENTS.SETTINGS_CHANGED);
        }
    }

    async function updateSettings(values: Partial<AppSettings>, refreshProvider = false): Promise<void> {
        settings = { ...settings, ...values };
        await settingsRepository.update(values);
        await emitTo('main', APP_EVENTS.SETTINGS_CHANGED);

        if (refreshProvider) {
            await refreshProviderState();
        }
    }

    async function handleProviderSelect(provider: ProviderId): Promise<void> {
        await updateSettings({ llmType: provider }, true);
    }

    async function handleOpenAIKeyChange(): Promise<void> {
        await updateSettings({ openaiApiKey: settings.openaiApiKey });
    }

    async function handleOllamaUrlChange(): Promise<void> {
        await updateSettings({ ollamaUrl: settings.ollamaUrl }, true);
    }

    async function handleOllamaModelChange(): Promise<void> {
        await updateSettings({ ollamaModel: settings.ollamaModel });
    }

    async function handleShowStartToggle(): Promise<void> {
        await updateSettings({ showStart: settings.showStart });
    }

    async function handleLogin(): Promise<void> {
        if (!settings.email.trim()) {
            loginMessage = 'Please enter an email address';
            loginIsError = true;
            return;
        }

        try {
            await updateSettings({ email: settings.email, llmType: 'pasteai' });
            const message = await providerGateway.loginPasteAI(settings.email.trim());
            loginMessage = message;
            loginIsError = false;
            await loadPasteAIQuota();
        } catch (error) {
            console.error('Login error:', error);
            loginMessage = error instanceof Error ? error.message : 'Failed to send verification email';
            loginIsError = true;
        }
    }

    function openPromptEditor(prompt?: PromptOption): void {
        if (!prompt) {
            previousSelectedPromptId = selectedPromptId;
            selectedPromptId = null;
        }

        editingPromptId = prompt?.id ?? null;
        promptTitle = prompt?.title ?? '';
        promptText = prompt?.prompt ?? '';
        promptEditorError = '';
        promptEditorVisible = true;
    }

    function closePromptEditor(): void {
        if (editingPromptId === null && selectedPromptId === null && previousSelectedPromptId !== null) {
            selectedPromptId = previousSelectedPromptId;
        }

        editingPromptId = null;
        previousSelectedPromptId = null;
        promptTitle = '';
        promptText = '';
        promptEditorError = '';
        promptEditorVisible = false;
    }

    async function savePrompt(): Promise<void> {
        const title = promptTitle.trim();
        const prompt = promptText.trim();
        if (!title || !prompt) {
            promptEditorError = 'Please fill in both title and prompt instructions.';
            return;
        }

        if (editingPromptId !== null) {
            await promptRepository.updatePrompt(editingPromptId, title, prompt);
            await refreshPromptState(editingPromptId);
        } else {
            const beforeIds = new Set((await promptRepository.getAllPrompts()).map((entry) => entry.id));
            await promptRepository.addPrompt(title, prompt);
            const updatedPrompts = await promptRepository.getAllPrompts();
            const newestPrompt = updatedPrompts.find((entry) => !beforeIds.has(entry.id)) ?? null;
            await refreshPromptState(newestPrompt?.id ?? null);
        }

        closePromptEditor();
        await emitTo('main', APP_EVENTS.PROMPTS_CHANGED);
    }

    async function deleteSelectedPrompt(): Promise<void> {
        if (!selectedPrompt || selectedPrompt.id < 1000) {
            return;
        }

        await promptRepository.deletePrompt(selectedPrompt.id);
        closePromptEditor();
        await refreshPromptState();
        await emitTo('main', APP_EVENTS.PROMPTS_CHANGED);
    }

    async function setDefaultPrompt(): Promise<void> {
        if (!selectedPrompt) {
            return;
        }

        await promptRepository.setDefaultPromptId(selectedPrompt.id);
        await refreshPromptState(selectedPrompt.id);
        await emitTo('main', APP_EVENTS.PROMPTS_CHANGED);
    }

    async function clearDefaultPrompt(): Promise<void> {
        await promptRepository.setDefaultPromptId(null);
        await refreshPromptState(selectedPromptId);
        await emitTo('main', APP_EVENTS.PROMPTS_CHANGED);
    }

    onMount(() => {
        let unlistenOpen: (() => void) | undefined;
        let unlistenCloseRequested: (() => void) | undefined;

        void (async () => {
            const currentWindow = Window.getCurrent();

            unlistenOpen = await currentWindow.listen<DashboardOpenPayload>(APP_EVENTS.DASHBOARD_OPEN, (event) => {
                setActiveSection(event.payload.section);
            });
            unlistenCloseRequested = await currentWindow.onCloseRequested(async (event) => {
                event.preventDefault();
                await currentWindow.hide();
            });

            const payload: WindowReadyPayload = { windowId: 'dashboard' };
            await emitTo('main', APP_EVENTS.WINDOW_READY, payload);

            try {
                await initializeDashboard();
            } catch (error) {
                console.error('Failed to initialize dashboard window:', error);
            }
        })();

        return () => {
            unlistenOpen?.();
            unlistenCloseRequested?.();
        };
    });
</script>

<WindowShell
    title="Settings"
    eyebrow="pasteAI"
    variant="utility"
>
    <main class="window-page dashboard-shell">
        <div class="dashboard-layout">
            <nav class="dashboard-tabs fade-up" aria-label="Dashboard sections">
                <button class:active={activeSection === 'welcome'} type="button" on:click={() => setActiveSection('welcome')}>
                    Welcome
                </button>
                <button class:active={activeSection === 'providers'} type="button" on:click={() => setActiveSection('providers')}>
                    AI Provider
                </button>
                <button class:active={activeSection === 'prompts'} type="button" on:click={() => setActiveSection('prompts')}>
                    Prompt Library
                </button>
                <button class:active={activeSection === 'about'} type="button" on:click={() => setActiveSection('about')}>
                    About
                </button>
            </nav>

            <section class="dashboard-panel">
                <section bind:this={welcomeSectionElement} class:active={activeSection === 'welcome'} class="dashboard-section">
                    <section class="surface-card start-hero fade-up">
                        <div class="start-hero__copy">
                            <span class="eyebrow">Clipboard utility</span>
                            <h2 class="display-title">Three quick copies. Cleaner writing.</h2>
                            <p>pasteAI stays out of your way until you deliberately ask for help. Select text, triple-copy, and get a polished version back in the clipboard without leaving the app you are already using.</p>
                            <div class="start-actions">
                                <button class="app-button app-button--primary" type="button" on:click={() => setActiveSection('providers')}>Open provider setup</button>
                                <button class="app-button app-button--secondary" type="button" on:click={() => setActiveSection('prompts')}>Manage prompt library</button>
                            </div>
                        </div>

                        <aside class="start-hero__panel">
                            <span class="meta-label">Launch behavior</span>
                            <strong>Open this welcome section on app launch.</strong>
                            <label class="start-toggle">
                                <input type="checkbox" bind:checked={settings.showStart} on:change={() => void handleShowStartToggle()}>
                                <span>Show the welcome guide when pasteAI starts</span>
                            </label>
                            <span class="chip">Tray-first desktop app</span>
                        </aside>
                    </section>

                    <section class="start-step-grid">
                        <article class="surface-card start-step fade-up">
                            <span class="start-step__number">1</span>
                            <h3>Copy the original text</h3>
                            <p>Select a sentence, paragraph, or draft you want to improve and copy it like you normally would.</p>
                        </article>
                        <article class="surface-card start-step fade-up">
                            <span class="start-step__number">2</span>
                            <h3>Repeat the copy gesture</h3>
                            <p>Copy the same selection twice more within a moment to confirm that you want pasteAI to step in.</p>
                        </article>
                        <article class="surface-card start-step fade-up">
                            <span class="start-step__number">3</span>
                            <h3>Paste the refined version</h3>
                            <p>The improved text replaces the clipboard automatically, ready to paste wherever you were writing.</p>
                        </article>
                    </section>

                    <section class="start-callout-grid fade-up">
                        <article class="callout-card start-callout">
                            <h3>Keep it private when needed</h3>
                            <p>Switch to Ollama when you want text improvements to stay on your own machine.</p>
                        </article>
                        <article class="callout-card start-callout">
                            <h3>Choose the writing style each time</h3>
                            <p>Clear the default prompt if you want to pick a mode per clipboard run.</p>
                        </article>
                    </section>
                </section>

                <section bind:this={providersSectionElement} class:active={activeSection === 'providers'} class="dashboard-section">
                    <div class="dashboard-section__panel">
                        <div class="section-heading">
                            <span class="section-kicker">AI Provider</span>
                            <h2>Choose where the rewrite happens.</h2>
                            <p>Provider changes save automatically and apply to the next clipboard improvement.</p>
                        </div>

                        <div class="provider-grid">
                            <button class:is-active={settings.llmType === 'pasteai'} class="provider-card" type="button" on:click={() => void handleProviderSelect('pasteai')}>
                                <div class="provider-card__label">
                                    <strong>PasteAI Account</strong>
                                    <span class="chip chip--success">Managed</span>
                                </div>
                                <p>Use your PasteAI balance with account-linked quota tracking and the quickest setup.</p>
                            </button>
                            <button class:is-active={settings.llmType === 'openai'} class="provider-card" type="button" on:click={() => void handleProviderSelect('openai')}>
                                <div class="provider-card__label">
                                    <strong>OpenAI</strong>
                                    <span class="chip chip--muted">API key</span>
                                </div>
                                <p>Bring your own API key when you want direct control over account billing and provider usage.</p>
                            </button>
                            <button class:is-active={settings.llmType === 'ollama'} class="provider-card" type="button" on:click={() => void handleProviderSelect('ollama')}>
                                <div class="provider-card__label">
                                    <strong>Ollama</strong>
                                    <span class="chip chip--muted">Local</span>
                                </div>
                                <p>Route text through a local model for offline or private improvement workflows.</p>
                            </button>
                        </div>

                        {#if settings.llmType === 'pasteai'}
                            <section class="provider-panel panel-card is-visible">
                                <div class="field-label">
                                    <label for="pasteAIEmail">PasteAI email</label>
                                    <span>Log in to attach balance and account status to this device.</span>
                                </div>

                                {#if pasteAILinkedEmail}
                                    <div class="status-note status-note--success">
                                        <div class="chip chip--success">Linked</div>
                                        <div>Connected via {pasteAILinkedEmail}</div>
                                    </div>
                                {:else}
                                    <div class="field-row">
                                        <input id="pasteAIEmail" type="email" bind:value={settings.email} placeholder="you@example.com">
                                        <button class="app-button app-button--primary" type="button" on:click={() => void handleLogin()}>Send login link</button>
                                    </div>
                                {/if}

                                {#if loginMessage}
                                    <div class={`status is-visible ${loginIsError ? 'status--error' : 'status--success'}`}>{loginMessage}</div>
                                {/if}
                                {#if quotaMessage}
                                    <div class={`status is-visible ${quotaIsError ? 'status--error' : 'status--success'}`}>{quotaMessage}</div>
                                {/if}
                            </section>
                        {/if}

                        {#if settings.llmType === 'openai'}
                            <section class="provider-panel panel-card is-visible">
                                <div class="field-label">
                                    <label for="apiKey">OpenAI API key</label>
                                    <span>Paste your API key here to send clipboard rewrites through OpenAI.</span>
                                </div>
                                <input id="apiKey" type="password" bind:value={settings.openaiApiKey} placeholder="sk-..." on:change={() => void handleOpenAIKeyChange()}>
                            </section>
                        {/if}

                        {#if settings.llmType === 'ollama'}
                            <section class="provider-stack">
                                <section class="provider-panel panel-card is-visible">
                                    <div class="field-label">
                                        <label for="ollamaUrl">Ollama URL</label>
                                        <span>Point pasteAI at the Ollama server you want to use.</span>
                                    </div>
                                    <input id="ollamaUrl" type="text" bind:value={settings.ollamaUrl} on:change={() => void handleOllamaUrlChange()}>

                                    {#if !ollamaAvailable}
                                        <div class="status is-visible status--error">Ollama is not reachable. Install it from <a href="https://ollama.com/download" target="_blank">ollama.com</a> or check the URL above.</div>
                                    {/if}
                                </section>

                                <section class="provider-panel panel-card is-visible">
                                    <div class="field-label">
                                        <label for="ollamaModel">Ollama model</label>
                                        <span>Choose one of the models currently available on the configured Ollama instance.</span>
                                    </div>
                                    <select id="ollamaModel" bind:value={settings.ollamaModel} on:change={() => void handleOllamaModelChange()}>
                                        <option value="">{ollamaModels.length === 0 ? 'No models found' : 'Select a model'}</option>
                                        {#each ollamaModels as model}
                                            <option value={model}>{model}</option>
                                        {/each}
                                    </select>
                                    <div class="status-note status-note--warning">
                                        <div class="chip chip--muted">CLI</div>
                                        <div>Install models in the terminal with commands like <code>ollama pull phi3:mini</code>.</div>
                                    </div>
                                </section>
                            </section>
                        {/if}
                    </div>
                </section>

                <section bind:this={promptsSectionElement} class:active={activeSection === 'prompts'} class="dashboard-section">
                    <div class="dashboard-section__panel">
                        <div class="section-heading">
                            <span class="section-kicker">Prompt Library</span>
                            <h2>Curate the writing modes available to pasteAI.</h2>
                            <p>Built-in prompts stay read-only, while custom prompts can be edited, deleted, and set as the default mode.</p>
                        </div>

                        <div class="prompt-workspace">
                            <div class="prompt-column">
                                <div class="panel-card prompt-list-shell">
                                    <div class="prompt-list-toolbar">
                                        <div>
                                            <span class="meta-label">Library</span>
                                            <div class="muted-copy">Select a prompt to preview it.</div>
                                        </div>
                                        <button class="app-button app-button--primary" type="button" on:click={() => openPromptEditor()}>New prompt</button>
                                    </div>
                                    <div class="prompt-list">
                                        {#each prompts as prompt}
                                            <button class:is-selected={selectedPromptId === prompt.id} class="prompt-item" type="button" on:click={() => selectedPromptId = prompt.id}>
                                                <div class="prompt-item__topline">
                                                    <div class="prompt-item__title">{prompt.title}</div>
                                                    <span class={`chip ${prompt.id < 1000 ? 'chip--muted' : ''}`}>
                                                        {defaultPromptId === prompt.id ? 'Default' : prompt.id < 1000 ? 'Built-in' : 'Custom'}
                                                    </span>
                                                </div>
                                                <div class="prompt-item__excerpt">{prompt.prompt}</div>
                                            </button>
                                        {/each}
                                    </div>
                                </div>
                            </div>

                            <div class="prompt-detail">
                                <div class="prompt-detail-stack">
                                    {#if showPromptEmptyState}
                                        <div class="detail-empty">Select a prompt to inspect its instructions or create a new custom mode.</div>
                                    {:else if showPromptPreview}
                                        <article class="panel-card prompt-preview is-visible">
                                            <div class="section-heading">
                                                <span class={`chip ${selectedPromptIsDefault ? 'chip--success' : selectedPromptIsBuiltIn ? 'chip--muted' : ''}`}>
                                                    {selectedPromptIsDefault ? 'Default prompt' : selectedPromptIsBuiltIn ? 'Built-in prompt' : 'Custom prompt'}
                                                </span>
                                                <h2>{selectedPrompt.title}</h2>
                                                <p>{selectedPromptIsBuiltIn ? 'A built-in mode that ships with pasteAI.' : 'A custom mode you created for your own workflow.'}</p>
                                            </div>
                                            <div class="prompt-preview__body">{selectedPrompt.prompt}</div>
                                            <div class="prompt-preview__actions">
                                                <button class="app-button app-button--primary" type="button" disabled={selectedPromptIsDefault} on:click={() => void setDefaultPrompt()}>Use as default</button>
                                                <button class="app-button app-button--secondary" type="button" disabled={defaultPromptId === null} on:click={() => void clearDefaultPrompt()}>Choose every time</button>
                                                <button class="app-button app-button--secondary" type="button" disabled={selectedPromptIsBuiltIn} on:click={() => openPromptEditor(selectedPrompt)}>Edit prompt</button>
                                                <button class="app-button app-button--ghost" type="button" disabled={selectedPromptIsBuiltIn} on:click={() => void deleteSelectedPrompt()}>Delete</button>
                                            </div>
                                        </article>
                                    {/if}

                                    {#if promptEditorVisible}
                                        <section class="panel-card prompt-editor is-visible">
                                            <div class="section-heading">
                                                <span class="section-kicker">Prompt editor</span>
                                                <h2>{editingPromptId === null ? 'Create a custom prompt' : 'Edit custom prompt'}</h2>
                                                <p>Custom prompts appear in the selector window and can be used as the default mode.</p>
                                            </div>

                                            <div class="prompt-editor__fields">
                                                <div>
                                                    <label class="field-label" for="promptTitle">
                                                        <strong>Prompt title</strong>
                                                        <span>Use a short, practical name for the prompt picker.</span>
                                                    </label>
                                                    <input id="promptTitle" type="text" bind:value={promptTitle} placeholder="Example: Sharpen for email">
                                                </div>

                                                <div>
                                                    <label class="field-label" for="promptText">
                                                        <strong>Prompt instructions</strong>
                                                        <span>Describe the tone, structure, and constraints for the rewrite.</span>
                                                    </label>
                                                    <textarea id="promptText" bind:value={promptText} placeholder="Tell pasteAI how to improve the copied text."></textarea>
                                                </div>
                                            </div>

                                            {#if promptEditorError}
                                                <div class="status is-visible status--error">{promptEditorError}</div>
                                            {/if}

                                            <div class="prompt-editor__actions">
                                                <button class="app-button app-button--primary" type="button" on:click={() => void savePrompt()}>Save prompt</button>
                                                <button class="app-button app-button--secondary" type="button" on:click={closePromptEditor}>Cancel</button>
                                            </div>
                                        </section>
                                    {/if}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section bind:this={aboutSectionElement} class:active={activeSection === 'about'} class="dashboard-section">
                    <div class="about-shell">
                        <section class="surface-card about-hero fade-up">
                            <div class="about-mark">PA</div>
                            <div class="about-copy">
                                <span class="eyebrow">Desktop writing utility</span>
                                <h2 class="display-title">Clipboard improvement without the ceremony.</h2>
                                <p>pasteAI is a compact desktop tool for polishing text where you already work. Choose a provider, shape the output with prompts, and trigger rewrites with a deliberate triple-copy gesture.</p>
                                <div class="about-links">
                                    <a href="https://github.com/LimTec-de/pasteAi" class="app-button app-button--primary" target="_blank">View on GitHub</a>
                                    <a href="https://github.com/LimTec-de/pasteAi/blob/master/LEGAL.md" class="app-button app-button--secondary" target="_blank">Legal information</a>
                                </div>
                            </div>
                        </section>

                        <section class="about-meta fade-up">
                            <article class="panel-card">
                                <span class="section-kicker">Version</span>
                                <h3>{version}</h3>
                                <p>The currently running desktop build on this machine.</p>
                            </article>
                            <article class="panel-card">
                                <span class="section-kicker">Providers</span>
                                <h3>PasteAI, OpenAI, or Ollama</h3>
                                <p>Use a managed account, your own API key, or a local model depending on privacy and workflow needs.</p>
                            </article>
                        </section>

                        <section class="surface-card panel-card fade-up">
                            <div class="section-heading">
                                <span class="section-kicker">Further links</span>
                                <h2>Support, legal, and company details</h2>
                                <p>Everything related to licensing, contact, and terms is grouped here for quick access.</p>
                            </div>
                            <div class="about-links">
                                <a href="https://www.limtec.de/#imprint" class="app-button app-button--ghost" target="_blank">Imprint</a>
                                <a href="https://openai.com/policies/terms-of-use" class="app-button app-button--ghost" target="_blank">OpenAI terms</a>
                            </div>
                        </section>
                    </div>
                </section>
            </section>
        </div>
    </main>
</WindowShell>
