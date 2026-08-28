<script lang="ts">
    import { emitTo } from '@tauri-apps/api/event';
    import { getVersion } from '@tauri-apps/api/app';
    import { Window } from '@tauri-apps/api/window';
    import clipboard from 'tauri-plugin-clipboard-api';
    import { onMount } from 'svelte';
    import { SHELL_INSTALL_COMMANDS } from '../../config';
    import { isForbiddenDictateShortcut, keyboardEventToAccelerator } from '../../platform/shortcut';
    import { APP_EVENTS, type DashboardOpenPayload, type WindowReadyPayload } from '../../app/events';
    import { AppStore } from '../../domain/store';
    import { PromptRepository } from '../../domain/prompt-repository';
    import { DEFAULT_SETTINGS, SettingsRepository } from '../../domain/settings-repository';
    import { ProviderGateway } from '../../domain/provider-gateway';
    import {
        DEFAULT_DICTATE_PROMPT_ID,
        fallbackSpeechLanguageCatalog,
        languageDisplayName,
        type AppSettings,
        type DashboardSection,
        type DictateOutputMode,
        type DictationProviderId,
        type PromptOption,
        type PromptOutputMode,
        type ProviderId,
        type SpeechLanguageCatalog
    } from '../../domain/types';
    import { getAppleSpeechAvailability, getAppleTextAvailability, installSpeechLanguage, listAppleInputDevices, listSpeechLanguages, type AppleAvailability, type AudioInputDevice, UNAVAILABLE_ON_MAC } from '../../domain/apple-system';
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
    let promptIdentifier = '';
    let promptOutputMode: PromptOutputMode = 'clipboard';
    let promptEditorError = '';

    let editTitle = '';
    let editText = '';
    let editIdentifier = '';
    let inlineEditId: number | null = null;
    let inlineEditError = '';

    let quotaMessage = '';
    let quotaIsError = false;
    let loginMessage = '';
    let loginIsError = false;
    let pasteAILinkedEmail: string | null = null;

    let ollamaAvailable = true;
    let ollamaModels: string[] = [];
    let appleTextAvailability: AppleAvailability = UNAVAILABLE_ON_MAC;
    let appleSpeechAvailability: AppleAvailability = UNAVAILABLE_ON_MAC;
    let recordingShortcut = false;
    let shortcutMessage = '';
    let shortcutIsError = false;
    let microphoneDevices: AudioInputDevice[] = [];
    let microphoneMessage = '';
    let speechCatalog: SpeechLanguageCatalog = fallbackSpeechLanguageCatalog();
    let languagePickerOpen = false;
    let languageMessage = '';
    let installingLanguage: string | null = null;
    let speechAssetPoll: ReturnType<typeof setInterval> | null = null;

    let version = 'Loading version...';
    let welcomeSectionElement: HTMLElement | null = null;
    let providersSectionElement: HTMLElement | null = null;
    let dictationSectionElement: HTMLElement | null = null;
    let promptsSectionElement: HTMLElement | null = null;
    let shellSectionElement: HTMLElement | null = null;
    let aboutSectionElement: HTMLElement | null = null;

    const shellBashCommand = SHELL_INSTALL_COMMANDS.bash;
    const shellZshCommand = SHELL_INSTALL_COMMANDS.zsh;
    let copiedShellCommand: 'bash' | 'zsh' | null = null;
    let copiedShellTimeout: number | null = null;

    async function copyShellCommand(shell: 'bash' | 'zsh', command: string): Promise<void> {
        await clipboard.writeText(command);
        copiedShellCommand = shell;
        if (copiedShellTimeout !== null) {
            window.clearTimeout(copiedShellTimeout);
        }
        copiedShellTimeout = window.setTimeout(() => {
            copiedShellCommand = null;
            copiedShellTimeout = null;
        }, 1500);
    }

    $: selectedPrompt = prompts.find((prompt) => prompt.id === selectedPromptId) ?? null;
    $: selectedPromptIsBuiltIn = selectedPrompt ? selectedPrompt.id < 1000 : false;
    $: selectedPromptIsDefault = selectedPrompt ? selectedPrompt.id === defaultPromptId : false;
    $: showPromptPreview = !!selectedPrompt && !(promptEditorVisible && editingPromptId === null);
    $: showPromptEmptyState = !selectedPrompt && !(promptEditorVisible && editingPromptId === null);

    $: if (selectedPrompt && selectedPrompt.id !== inlineEditId) {
        inlineEditId = selectedPrompt.id;
        editTitle = selectedPrompt.title;
        editText = selectedPrompt.prompt;
        editIdentifier = selectedPrompt.identifier;
        inlineEditError = '';
    }

    $: canSaveInlineEdit = !!selectedPrompt
        && !selectedPromptIsBuiltIn
        && editTitle.trim().length > 0
        && editText.trim().length > 0
        && (editTitle !== selectedPrompt.title || editText !== selectedPrompt.prompt || editIdentifier !== selectedPrompt.identifier);

    $: selectedMicrophoneId = microphoneDevices.some((device) => device.id === settings.dictateMicrophoneId)
        ? settings.dictateMicrophoneId
        : '';

    $: selectedDictatePromptValue = settings.dictatePromptId === null
        ? ''
        : (prompts.some((prompt) => prompt.id === settings.dictatePromptId)
            ? String(settings.dictatePromptId)
            : String(DEFAULT_DICTATE_PROMPT_ID));

    function setActiveSection(section: DashboardSection): void {
        activeSection = section;
        scrollActiveSectionToTop(section);
        if (section === 'providers') {
            void refreshProviderState();
            void refreshAppleAvailability();
        }
        if (section === 'dictation') {
            void refreshMicrophones();
            void refreshSpeechLanguages();
            void healDictatePromptId();
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
            case 'dictation':
                return dictationSectionElement;
            case 'prompts':
                return promptsSectionElement;
            case 'shell':
                return shellSectionElement;
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
        await healDictatePromptId();
        await refreshProviderState();
        await refreshAppleAvailability();
        await refreshSpeechLanguages();
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

    async function refreshAppleAvailability(): Promise<void> {
        try {
            appleTextAvailability = await getAppleTextAvailability();
            appleSpeechAvailability = await getAppleSpeechAvailability();
        } catch (error) {
            console.error('Could not check Apple Intelligence availability:', error);
            appleTextAvailability = UNAVAILABLE_ON_MAC;
            appleSpeechAvailability = UNAVAILABLE_ON_MAC;
        }
        syncSpeechAssetPoll();
    }

    function stopSpeechAssetPoll(): void {
        if (speechAssetPoll !== null) {
            clearInterval(speechAssetPoll);
            speechAssetPoll = null;
        }
    }

    function syncSpeechAssetPoll(): void {
        if (appleSpeechAvailability.reasonCode !== 'assetsNotReady') {
            stopSpeechAssetPoll();
            return;
        }
        if (speechAssetPoll !== null) {
            return;
        }
        speechAssetPoll = setInterval(() => {
            void refreshAppleAvailability();
        }, 2000);
    }

    async function handleProviderSelect(provider: ProviderId): Promise<void> {
        if (provider === 'apple' && !appleTextAvailability.available) {
            return;
        }

        await updateSettings({ llmType: provider }, true);
    }

    async function handleDictationProviderSelect(provider: DictationProviderId): Promise<void> {
        if (provider === 'apple' && !appleSpeechAvailability.available) {
            return;
        }

        await updateSettings({ dictationProvider: provider });
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

    async function handleImproveHtmlToggle(): Promise<void> {
        await updateSettings({ improveHtml: settings.improveHtml });
    }

    async function saveDictateShortcut(accelerator: string): Promise<void> {
        if (isForbiddenDictateShortcut(accelerator)) {
            shortcutMessage = 'That shortcut would steal Copy. Pick another combination.';
            shortcutIsError = true;
            return;
        }

        shortcutMessage = '';
        shortcutIsError = false;
        await updateSettings({ dictateShortcut: accelerator });
    }

    function startShortcutRecording(): void {
        recordingShortcut = true;
        shortcutMessage = '';
        shortcutIsError = false;
    }

    function handleShortcutKeydown(event: KeyboardEvent): void {
        if (!recordingShortcut) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (event.key === 'Escape') {
            recordingShortcut = false;
            return;
        }

        const accelerator = keyboardEventToAccelerator(event);
        if (!accelerator) {
            return;
        }

        recordingShortcut = false;
        void saveDictateShortcut(accelerator);
    }

    function languageLabel(code: string): string {
        return speechCatalog.languages.find((language) => language.code === code)?.label
            ?? languageDisplayName(code);
    }

    function isDictateLanguageActive(code: string): boolean {
        return settings.dictateLanguages.includes(code);
    }

    async function refreshSpeechLanguages(): Promise<void> {
        speechCatalog = await listSpeechLanguages();
    }

    async function toggleDictateLanguage(code: string): Promise<void> {
        const active = settings.dictateLanguages;
        if (active.includes(code)) {
            if (active.length <= 1) {
                return;
            }
            await updateSettings({ dictateLanguages: active.filter((item) => item !== code) });
            return;
        }

        if (active.length >= speechCatalog.maxActiveLanguages) {
            return;
        }

        await updateSettings({ dictateLanguages: [...active, code] });
    }

    async function addDictateLanguage(code: string): Promise<void> {
        languagePickerOpen = false;
        if (!code || settings.dictateDownloadedLanguages.includes(code) || installingLanguage) {
            return;
        }

        languageMessage = '';
        installingLanguage = code;
        try {
            if (settings.dictationProvider === 'apple') {
                await installSpeechLanguage(code);
            }

            const downloaded = [...settings.dictateDownloadedLanguages, code];
            const active = settings.dictateLanguages.length < speechCatalog.maxActiveLanguages
                ? [...settings.dictateLanguages, code]
                : settings.dictateLanguages;
            await updateSettings({
                dictateDownloadedLanguages: downloaded,
                dictateLanguages: active
            });
        } catch (error) {
            languageMessage = error instanceof Error ? error.message : 'Could not add language.';
        } finally {
            installingLanguage = null;
        }
    }

    function handleAddLanguageChange(event: Event): void {
        const select = event.currentTarget as HTMLSelectElement;
        const code = select.value;
        select.value = '';
        void addDictateLanguage(code);
    }

    async function handleDictateMicrophoneChange(event: Event): Promise<void> {
        const value = (event.currentTarget as HTMLSelectElement).value;
        await updateSettings({ dictateMicrophoneId: value });
    }

    async function handleDictateOutputModeChange(mode: DictateOutputMode): Promise<void> {
        await updateSettings({ dictateOutputMode: mode });
    }

    async function handleDictatePromptChange(event: Event): Promise<void> {
        const value = (event.currentTarget as HTMLSelectElement).value;
        const dictatePromptId = value === '' ? null : Number.parseInt(value, 10);
        await updateSettings({ dictatePromptId });
    }

    async function healDictatePromptId(): Promise<void> {
        const id = settings.dictatePromptId;
        if (id === null) {
            return;
        }

        if (prompts.some((prompt) => prompt.id === id)) {
            return;
        }

        await updateSettings({ dictatePromptId: DEFAULT_DICTATE_PROMPT_ID });
    }

    async function refreshMicrophones(): Promise<void> {
        microphoneMessage = '';
        try {
            if (settings.dictationProvider === 'apple') {
                microphoneDevices = await listAppleInputDevices();
                return;
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((track) => track.stop());
            const devices = await navigator.mediaDevices.enumerateDevices();
            microphoneDevices = devices
                .filter((device) => device.kind === 'audioinput' && device.deviceId.length > 0)
                .map((device) => ({
                    id: device.deviceId,
                    label: device.label || 'Microphone'
                }));
        } catch (error) {
            microphoneDevices = [];
            microphoneMessage = error instanceof Error ? error.message : 'Could not list microphones.';
        }
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
        promptIdentifier = prompt?.identifier ?? '';
        promptOutputMode = prompt?.outputMode ?? 'clipboard';
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
        promptIdentifier = '';
        promptOutputMode = 'clipboard';
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

        try {
            if (editingPromptId !== null) {
                await promptRepository.updatePrompt(editingPromptId, title, prompt, promptIdentifier.trim(), promptOutputMode);
                await refreshPromptState(editingPromptId);
            } else {
                const beforeIds = new Set((await promptRepository.getAllPrompts()).map((entry) => entry.id));
                await promptRepository.addPrompt(title, prompt, promptIdentifier.trim(), promptOutputMode);
                const updatedPrompts = await promptRepository.getAllPrompts();
                const newestPrompt = updatedPrompts.find((entry) => !beforeIds.has(entry.id)) ?? null;
                await refreshPromptState(newestPrompt?.id ?? null);
            }
        } catch (error) {
            promptEditorError = error instanceof Error ? error.message : 'Could not save the prompt.';
            return;
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

    async function saveInlineEdit(): Promise<void> {
        if (!selectedPrompt || selectedPromptIsBuiltIn || !canSaveInlineEdit) {
            return;
        }

        editTitle = editTitle.trim();
        editText = editText.trim();
        const identifier = editIdentifier.trim();

        try {
            await promptRepository.updatePrompt(selectedPrompt.id, editTitle, editText, identifier, selectedPrompt.outputMode);
        } catch (error) {
            inlineEditError = error instanceof Error ? error.message : 'Could not save the prompt.';
            return;
        }

        inlineEditError = '';
        await refreshPromptState(selectedPrompt.id);
        await emitTo('main', APP_EVENTS.PROMPTS_CHANGED);
    }

    async function handleOutputModeChange(mode: PromptOutputMode): Promise<void> {
        if (!selectedPrompt || selectedPrompt.outputMode === mode) {
            return;
        }

        await promptRepository.setOutputMode(selectedPrompt.id, mode);
        await refreshPromptState(selectedPrompt.id);
        await emitTo('main', APP_EVENTS.PROMPTS_CHANGED);
    }

    onMount(() => {
        let unlistenOpen: (() => void) | undefined;
        let unlistenCloseRequested: (() => void) | undefined;
        let unlistenFocus: (() => void) | undefined;

        void (async () => {
            const currentWindow = Window.getCurrent();

            unlistenOpen = await currentWindow.listen<DashboardOpenPayload>(APP_EVENTS.DASHBOARD_OPEN, (event) => {
                setActiveSection(event.payload.section);
            });
            unlistenCloseRequested = await currentWindow.onCloseRequested(async (event) => {
                event.preventDefault();
                await currentWindow.hide();
            });
            unlistenFocus = await currentWindow.onFocusChanged(({ payload: focused }) => {
                if (focused) {
                    void refreshAppleAvailability();
                }
            });

            const payload: WindowReadyPayload = { windowId: 'dashboard' };
            await emitTo('main', APP_EVENTS.WINDOW_READY, payload);

            try {
                await initializeDashboard();
            } catch (error) {
                console.error('Failed to initialize dashboard window:', error);
            }
        })();

        window.addEventListener('keydown', handleShortcutKeydown, true);
        const handleDeviceChange = () => {
            if (activeSection === 'dictation') {
                void refreshMicrophones();
            }
        };
        navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);

        return () => {
            unlistenOpen?.();
            unlistenCloseRequested?.();
            unlistenFocus?.();
            window.removeEventListener('keydown', handleShortcutKeydown, true);
            navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
            stopSpeechAssetPoll();
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
                <button class:active={activeSection === 'dictation'} type="button" on:click={() => setActiveSection('dictation')}>
                    Dictation
                </button>
                <button class:active={activeSection === 'prompts'} type="button" on:click={() => setActiveSection('prompts')}>
                    Prompt Library
                </button>
                <button class:active={activeSection === 'shell'} type="button" on:click={() => setActiveSection('shell')}>
                    Shell integration
                </button>
                <button class:active={activeSection === 'about'} type="button" on:click={() => setActiveSection('about')}>
                    About
                </button>
            </nav>

            <section class="dashboard-panel">
                <section bind:this={welcomeSectionElement} class:active={activeSection === 'welcome'} class="dashboard-section">
                    <div class="welcome">
                        <div class="welcome-hero fade-up">
                            <span class="eyebrow">Clipboard utility</span>
                            <h2 class="display-title">Three quick copies. Cleaner writing.</h2>
                            <p class="lede">pasteAI stays out of your way until you ask for help. Select text, triple-copy, and get a polished version back in your clipboard without leaving the app you are already using.</p>
                            <div class="start-actions">
                                <button class="app-button app-button--primary" type="button" on:click={() => setActiveSection('providers')}>Set up a provider</button>
                                <button class="app-button app-button--secondary" type="button" on:click={() => setActiveSection('prompts')}>Manage prompts</button>
                            </div>
                            <label class="start-toggle">
                                <input type="checkbox" bind:checked={settings.showStart} on:change={() => void handleShowStartToggle()}>
                                <span>Show this welcome guide when pasteAI starts</span>
                            </label>
                        </div>

                        <div class="welcome-steps fade-up">
                            <div class="welcome-step">
                                <span class="welcome-step__num">1</span>
                                <div>
                                    <strong>Copy the text</strong>
                                    <p>Select a sentence or paragraph and copy it like you normally would.</p>
                                </div>
                            </div>
                            <div class="welcome-step">
                                <span class="welcome-step__num">2</span>
                                <div>
                                    <strong>Repeat the copy</strong>
                                    <p>Copy the same selection twice more to confirm you want pasteAI to step in.</p>
                                </div>
                            </div>
                            <div class="welcome-step">
                                <span class="welcome-step__num">3</span>
                                <div>
                                    <strong>Paste the result</strong>
                                    <p>The improved text replaces your clipboard, ready to paste anywhere.</p>
                                </div>
                            </div>
                        </div>

                        <div class="welcome-shortcut panel-card fade-up">
                            <div class="section-heading">
                                <span class="section-kicker">Shortcut</span>
                                <h3>Trigger with a prefix instead of triple-copying</h3>
                                <p>Start your copied text with <code>pasteai:</code> and pasteAI steps in after a single copy.</p>
                            </div>
                            <ul class="welcome-shortcut__list">
                                <li>
                                    <code>pasteai: your text</code>
                                    <span>Uses your default prompt (or asks which one to use).</span>
                                </li>
                                <li>
                                    <code>pasteai:grammar: your text</code>
                                    <span>Targets a specific prompt by its <strong>identifier</strong> &mdash; here, <code>grammar</code>.</span>
                                </li>
                            </ul>
                            <p class="welcome-shortcut__note">Every prompt has an identifier shown in the Prompt Library. Built-in ones use names like <code>grammar</code>, <code>linkedin</code>, or <code>email</code>; for your own prompts you can pick any short name. The prefix is removed before the text is sent.</p>
                        </div>

                        <div class="welcome-tips fade-up">
                            <article class="callout-card start-callout">
                                <h3>Dictate at the cursor</h3>
                                <p>Hold the dictate shortcut (default {settings.dictateShortcut}) and speak. Release to insert the transcript where you were typing and copy it to the clipboard. A short tap keeps the window open — click Done when you are finished. Change the shortcut, language, microphone, and insert behavior under Dictation. Set the rewrite provider and dictation engine under AI Provider. On-device Mac options need macOS 26.</p>
                            </article>
                            <article class="callout-card start-callout">
                                <h3>Keep it private</h3>
                                <p>Switch to Apple Intelligence or Ollama to keep text improvements on this machine.</p>
                            </article>
                            <article class="callout-card start-callout">
                                <h3>Pick a style each time</h3>
                                <p>Clear the default prompt to choose a mode per clipboard run.</p>
                            </article>
                        </div>
                    </div>
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
                            <div class="provider-card-wrap">
                                <button
                                    class:is-active={settings.llmType === 'apple'}
                                    class:is-disabled={!appleTextAvailability.available}
                                    class="provider-card"
                                    type="button"
                                    disabled={!appleTextAvailability.available}
                                    on:click={() => void handleProviderSelect('apple')}
                                >
                                    <div class="provider-card__label">
                                        <strong>Apple Intelligence</strong>
                                        <span class="chip chip--muted">On-device</span>
                                    </div>
                                    <p>Rewrite with the system model already on this Mac. No API key, no cloud call.</p>
                                </button>
                                {#if !appleTextAvailability.available}
                                    <p class="provider-card__reason">{appleTextAvailability.message}</p>
                                {/if}
                            </div>
                        </div>

                        <div class="section-heading">
                            <span class="section-kicker">Dictation</span>
                            <h2>Choose how speech becomes text.</h2>
                            <p>Independent from rewrite. On-device dictation uses the Mac speech model, not Apple Intelligence.</p>
                        </div>

                        <div class="provider-grid">
                            <button class:is-active={settings.dictationProvider === 'openai'} class="provider-card" type="button" on:click={() => void handleDictationProviderSelect('openai')}>
                                <div class="provider-card__label">
                                    <strong>OpenAI</strong>
                                    <span class="chip chip--muted">API key</span>
                                </div>
                                <p>Hold-to-talk transcription with gpt-transcribe. Needs an OpenAI API key.</p>
                            </button>
                            <div class="provider-card-wrap">
                                <button
                                    class:is-active={settings.dictationProvider === 'apple'}
                                    class:is-disabled={!appleSpeechAvailability.available}
                                    class="provider-card"
                                    type="button"
                                    disabled={!appleSpeechAvailability.available}
                                    on:click={() => void handleDictationProviderSelect('apple')}
                                >
                                    <div class="provider-card__label">
                                        <strong>Mac (on-device)</strong>
                                        <span class="chip chip--muted">On-device</span>
                                    </div>
                                    <p>Dictate with the speech model already on this Mac. No API key.</p>
                                </button>
                                {#if appleSpeechAvailability.message}
                                    <p class="provider-card__reason">{appleSpeechAvailability.message}</p>
                                {/if}
                            </div>
                        </div>

                        <section class="provider-panel panel-card is-visible">
                            <div class="field-label">
                                <label for="apiKey">OpenAI API key</label>
                                <span>Required when OpenAI is selected for rewrite or dictation.</span>
                            </div>
                            <input id="apiKey" type="password" bind:value={settings.openaiApiKey} placeholder="sk-..." on:change={() => void handleOpenAIKeyChange()}>
                        </section>

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

                <section bind:this={dictationSectionElement} class:active={activeSection === 'dictation'} class="dashboard-section">
                    <div class="dashboard-section__panel">
                        <div class="section-heading">
                            <span class="section-kicker">Dictation</span>
                            <h2>Hold a shortcut, speak, insert the transcript.</h2>
                            <p>Choose the shortcut and how speech is captured. The dictation engine itself is under AI Provider.</p>
                        </div>

                        <section class="provider-panel panel-card is-visible">
                            <div class="field-label">
                                <label for="dictateShortcut">Dictate shortcut</label>
                                <span>Hold to dictate, release to insert at the cursor and copy. A short tap opens the window; click Done to insert and copy. Needs Control/Command or Alt plus a key.</span>
                            </div>
                            <div class="field-row">
                                <input
                                    id="dictateShortcut"
                                    type="text"
                                    readonly
                                    value={recordingShortcut ? 'Press a shortcut…' : settings.dictateShortcut}
                                    on:click={startShortcutRecording}
                                >
                                <button class="app-button app-button--secondary" type="button" on:click={startShortcutRecording}>
                                    {recordingShortcut ? 'Listening…' : 'Change'}
                                </button>
                            </div>
                            {#if shortcutMessage}
                                <div class={`status is-visible ${shortcutIsError ? 'status--error' : 'status--success'}`}>{shortcutMessage}</div>
                            {/if}
                        </section>

                        <section class="provider-panel panel-card is-visible">
                            <div class="field-label">
                                <div id="dictate-languages-label">Languages</div>
                                <span>Filled chips are used for dictation. Outline chips stay downloaded but idle. At least one stays on; at most {speechCatalog.maxActiveLanguages} can run at once.</span>
                            </div>
                            <div class="language-chips" role="group" aria-labelledby="dictate-languages-label">
                                {#each settings.dictateDownloadedLanguages as code}
                                    <button
                                        type="button"
                                        class="language-chip"
                                        class:is-active={isDictateLanguageActive(code)}
                                        title={isDictateLanguageActive(code)
                                            ? (settings.dictateLanguages.length <= 1
                                                ? 'At least one language must stay on'
                                                : `Use ${languageLabel(code)}`)
                                            : (settings.dictateLanguages.length >= speechCatalog.maxActiveLanguages
                                                ? 'Turn another language off first'
                                                : `Use ${languageLabel(code)}`)}
                                        on:click={() => void toggleDictateLanguage(code)}
                                    >
                                        {languageLabel(code)}
                                    </button>
                                {/each}
                                {#if installingLanguage}
                                    <span class="language-chip language-chip--busy">
                                        Downloading {languageLabel(installingLanguage)}
                                    </span>
                                {:else if speechCatalog.languages.some((language) => !settings.dictateDownloadedLanguages.includes(language.code))}
                                    {#if languagePickerOpen}
                                        <select
                                            class="language-chip-picker"
                                            on:change={handleAddLanguageChange}
                                        >
                                            <option value="">Add language…</option>
                                            {#each speechCatalog.languages.filter((language) => !settings.dictateDownloadedLanguages.includes(language.code)) as language}
                                                <option value={language.code}>{language.label}</option>
                                            {/each}
                                        </select>
                                    {:else}
                                        <button
                                            type="button"
                                            class="language-chip language-chip--add"
                                            title="Download another language"
                                            on:click={() => { languagePickerOpen = true; }}
                                        >
                                            +
                                        </button>
                                    {/if}
                                {/if}
                            </div>
                            {#if languageMessage}
                                <div class="status is-visible status--error">{languageMessage}</div>
                            {/if}
                        </section>

                        <section class="provider-panel panel-card is-visible">
                            <div class="field-label">
                                <label for="dictateMicrophone">Microphone</label>
                                <span>Used by the currently selected dictation engine. Leave on system default unless you need a specific input.</span>
                            </div>
                            <select id="dictateMicrophone" value={selectedMicrophoneId} on:change={(event) => void handleDictateMicrophoneChange(event)}>
                                <option value="">System default</option>
                                {#each microphoneDevices as device}
                                    <option value={device.id}>{device.label}</option>
                                {/each}
                            </select>
                            {#if microphoneMessage}
                                <div class="status is-visible status--error">{microphoneMessage}</div>
                            {/if}
                        </section>

                        <section class="provider-panel panel-card is-visible">
                            <div class="field-label">
                                <div id="dictate-output-label">When finished</div>
                                <span>Insert pastes into the app you were using. Copy only leaves the transcript on the clipboard.</span>
                            </div>
                            <div class="output-mode" role="group" aria-labelledby="dictate-output-label">
                                <div class="output-mode__options">
                                    <button class:is-active={settings.dictateOutputMode === 'insert'} type="button" on:click={() => void handleDictateOutputModeChange('insert')}>Insert and copy</button>
                                    <button class:is-active={settings.dictateOutputMode === 'clipboard'} type="button" on:click={() => void handleDictateOutputModeChange('clipboard')}>Copy only</button>
                                </div>
                            </div>
                        </section>

                        <section class="provider-panel panel-card is-visible">
                            <div class="field-label">
                                <label for="dictatePrompt">After speech</label>
                                <span>Rewrite with the AI provider before insert or copy. Choose Don’t rewrite for the raw transcript.</span>
                            </div>
                            <select id="dictatePrompt" value={selectedDictatePromptValue} on:change={(event) => void handleDictatePromptChange(event)}>
                                <option value="">Don’t rewrite</option>
                                {#each prompts as prompt}
                                    <option value={String(prompt.id)}>{prompt.title}</option>
                                {/each}
                            </select>
                        </section>
                    </div>
                </section>

                <section bind:this={promptsSectionElement} class:active={activeSection === 'prompts'} class="dashboard-section">
                    <div class="dashboard-section__panel">
                        <div class="section-heading">
                            <span class="section-kicker">Prompt Library</span>
                            <h2>Curate the writing modes available to pasteAI.</h2>
                            <p>Built-in prompts stay read-only, while custom prompts can be edited, deleted, and set as the default mode.</p>
                        </div>

                        <div class="panel-card">
                            <label class="start-toggle">
                                <input type="checkbox" bind:checked={settings.improveHtml} on:change={() => void handleImproveHtmlToggle()}>
                                <span>Improve as rich text (HTML) to keep tables, styles, and links from apps like Teams, Word, and Excel. Emojis are preserved either way. Default is plain text.</span>
                            </label>
                        </div>

                        <div class="prompt-workspace">
                            <div class="prompt-column">
                                <div class="panel-card prompt-list-shell">
                                    <div class="prompt-list-toolbar">
                                        <div>
                                            <span class="meta-label">Library</span>
                                            <div class="muted-copy">Choose a prompt to view it.</div>
                                        </div>
                                        <button class="app-button app-button--primary" type="button" on:click={() => openPromptEditor()}>New prompt</button>
                                    </div>
                                    <div class="prompt-list">
                                        {#each prompts as prompt}
                                            {@const isBuiltIn = prompt.id < 1000}
                                            {@const isDefault = defaultPromptId === prompt.id}
                                            <button class:is-selected={selectedPromptId === prompt.id} class="prompt-item" type="button" on:click={() => selectedPromptId = prompt.id}>
                                                <div class="prompt-item__title">{prompt.title}</div>
                                                {#if isDefault}
                                                    <span class="chip chip--success">Default</span>
                                                {:else if !isBuiltIn}
                                                    <span class="chip">Custom</span>
                                                {/if}
                                            </button>
                                        {/each}
                                    </div>
                                </div>
                            </div>

                            <div class="prompt-detail">
                                <div class="prompt-detail-stack">
                                    {#if showPromptEmptyState}
                                        <div class="detail-empty">Select a prompt to view its instructions, or create a new custom mode.</div>
                                    {:else if showPromptPreview && selectedPrompt}
                                        <article class="panel-card prompt-preview is-visible">
                                            {#if selectedPromptIsBuiltIn}
                                                <div class="section-heading">
                                                    <span class="chip chip--muted">Built-in prompt</span>
                                                    <h2>{selectedPrompt.title}</h2>
                                                    <p>A built-in mode that ships with pasteAI.</p>
                                                </div>
                                                <div class="prompt-preview__body">{selectedPrompt.prompt}</div>
                                                <div class="prompt-identifier-note">
                                                    <span class="meta-label">Identifier</span>
                                                    <code>pasteai:{selectedPrompt.identifier}:</code>
                                                </div>
                                                <div class="output-mode">
                                                    <span class="meta-label">When done</span>
                                                    <div class="output-mode__options">
                                                        <button class:is-active={selectedPrompt.outputMode === 'clipboard'} type="button" on:click={() => void handleOutputModeChange('clipboard')}>Auto-copy</button>
                                                        <button class:is-active={selectedPrompt.outputMode === 'window'} type="button" on:click={() => void handleOutputModeChange('window')}>Show window</button>
                                                    </div>
                                                </div>
                                                <div class="prompt-preview__actions">
                                                    {#if !selectedPromptIsDefault}
                                                        <button class="app-button app-button--primary" type="button" on:click={() => void setDefaultPrompt()}>Set as default</button>
                                                    {/if}
                                                </div>
                                                <p class="prompt-preview__note">Built-in prompts can't be edited.</p>
                                            {:else}
                                                <div class="section-heading">
                                                    <span class={`chip ${selectedPromptIsDefault ? 'chip--success' : ''}`}>
                                                        {selectedPromptIsDefault ? 'Default prompt' : 'Custom prompt'}
                                                    </span>
                                                </div>
                                                <div class="prompt-editor__fields">
                                                    <div>
                                                        <label class="field-label" for="editTitle">
                                                            <strong>Title</strong>
                                                            <span>Shown in the prompt picker.</span>
                                                        </label>
                                                        <input id="editTitle" type="text" bind:value={editTitle} placeholder="Example: Sharpen for email">
                                                    </div>
                                                    <div>
                                                        <label class="field-label" for="editIdentifier">
                                                            <strong>Identifier</strong>
                                                            <span>Used in the clipboard prefix, e.g. <code>pasteai:{editIdentifier.trim() || 'name'}:</code></span>
                                                        </label>
                                                        <input id="editIdentifier" type="text" bind:value={editIdentifier} placeholder="Example: email">
                                                    </div>
                                                    <div>
                                                        <label class="field-label" for="editText">
                                                            <strong>Instructions</strong>
                                                            <span>How pasteAI should rewrite the copied text.</span>
                                                        </label>
                                                        <textarea id="editText" bind:value={editText} placeholder="Tell pasteAI how to improve the copied text."></textarea>
                                                    </div>
                                                </div>
                                                <div class="output-mode">
                                                    <span class="meta-label">When done</span>
                                                    <div class="output-mode__options">
                                                        <button class:is-active={selectedPrompt.outputMode === 'clipboard'} type="button" on:click={() => void handleOutputModeChange('clipboard')}>Auto-copy</button>
                                                        <button class:is-active={selectedPrompt.outputMode === 'window'} type="button" on:click={() => void handleOutputModeChange('window')}>Show window</button>
                                                    </div>
                                                </div>
                                                {#if inlineEditError}
                                                    <div class="status is-visible status--error">{inlineEditError}</div>
                                                {/if}
                                                <div class="prompt-preview__actions">
                                                    {#if !selectedPromptIsDefault}
                                                        <button class="app-button app-button--primary" type="button" on:click={() => void setDefaultPrompt()}>Set as default</button>
                                                    {/if}
                                                    <button class="app-button app-button--secondary" type="button" disabled={!canSaveInlineEdit} on:click={() => void saveInlineEdit()}>Save</button>
                                                    <button class="app-button app-button--ghost" type="button" on:click={() => void deleteSelectedPrompt()}>Delete</button>
                                                </div>
                                            {/if}
                                        </article>
                                    {/if}

                                    {#if promptEditorVisible}
                                        <section class="panel-card prompt-editor is-visible">
                                            <div class="section-heading">
                                                <span class="section-kicker">Prompt editor</span>
                                                <h2>{editingPromptId === null ? 'Create a custom prompt' : 'Edit custom prompt'}</h2>
                                                <p>Custom prompts appear in the selector window and can be set as the default mode.</p>
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
                                                    <label class="field-label" for="promptIdentifier">
                                                        <strong>Identifier</strong>
                                                        <span>Used in the clipboard prefix, e.g. <code>pasteai:{promptIdentifier.trim() || 'name'}:</code> Leave blank to derive it from the title.</span>
                                                    </label>
                                                    <input id="promptIdentifier" type="text" bind:value={promptIdentifier} placeholder="Example: email">
                                                </div>

                                                <div>
                                                    <label class="field-label" for="promptText">
                                                        <strong>Prompt instructions</strong>
                                                        <span>Describe the tone, structure, and constraints for the rewrite.</span>
                                                    </label>
                                                    <textarea id="promptText" bind:value={promptText} placeholder="Tell pasteAI how to improve the copied text."></textarea>
                                                </div>
                                            </div>

                                            <div class="output-mode">
                                                <span class="meta-label">When done</span>
                                                <div class="output-mode__options">
                                                    <button class:is-active={promptOutputMode === 'clipboard'} type="button" on:click={() => promptOutputMode = 'clipboard'}>Auto-copy</button>
                                                    <button class:is-active={promptOutputMode === 'window'} type="button" on:click={() => promptOutputMode = 'window'}>Show window</button>
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

                <section bind:this={shellSectionElement} class:active={activeSection === 'shell'} class="dashboard-section">
                    <div class="dashboard-section__panel">
                        <div class="section-heading">
                            <span class="section-kicker">Shell integration</span>
                            <h2>Turn plain English into shell commands.</h2>
                            <p>Add a tiny <code>p</code> helper to your shell, then type what you want and pasteAI returns the command.</p>
                        </div>

                        <div class="shell-steps panel-card">
                            <div class="section-heading">
                                <span class="section-kicker">How it works</span>
                                <h3>Type <code>p</code> followed by your request</h3>
                            </div>
                            <ul class="shell-steps__list">
                                <li>
                                    <code>p git push and commit</code>
                                    <span>The helper copies <code>pasteai:shell:git push and commit</code> to your clipboard using the OSC 52 terminal escape.</span>
                                </li>
                                <li>
                                    <span>pasteAI detects the prefix, generates the command, and shows it in a result window for you to review before running.</span>
                                </li>
                            </ul>
                        </div>

                        <div class="shell-install panel-card">
                            <div class="section-heading">
                                <span class="section-kicker">Install the helper</span>
                                <h3>Paste one line into your shell</h3>
                                <p>This appends the <code>p</code> function to your shell config and loads it right away, so it works in the same session.</p>
                            </div>

                            <div class="shell-snippet">
                                <div class="shell-snippet__head">
                                    <span class="meta-label">bash</span>
                                    <button class="app-button app-button--secondary" type="button" on:click={() => void copyShellCommand('bash', shellBashCommand)}>
                                        {copiedShellCommand === 'bash' ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                                <pre class="shell-snippet__code"><code>{shellBashCommand}</code></pre>
                            </div>

                            <div class="shell-snippet">
                                <div class="shell-snippet__head">
                                    <span class="meta-label">zsh</span>
                                    <button class="app-button app-button--secondary" type="button" on:click={() => void copyShellCommand('zsh', shellZshCommand)}>
                                        {copiedShellCommand === 'zsh' ? 'Copied' : 'Copy'}
                                    </button>
                                </div>
                                <pre class="shell-snippet__code"><code>{shellZshCommand}</code></pre>
                            </div>
                        </div>

                        <div class="status-note status-note--warning">
                            <div class="chip chip--muted">Terminal</div>
                            <div>The <code>p</code> helper needs a terminal that supports OSC 52 clipboard writes (iTerm2, kitty, WezTerm, recent xterm). iTerm2 may require enabling "Allow clipboard access". macOS Terminal.app does not support it by default, and inside tmux you need <code>set -g set-clipboard on</code>.</div>
                        </div>
                    </div>
                </section>

                <section bind:this={aboutSectionElement} class:active={activeSection === 'about'} class="dashboard-section">
                    <div class="about-shell">
                        <div class="about-hero fade-up">
                            <div class="about-mark">PA</div>
                            <div class="about-copy">
                                <span class="eyebrow">Desktop writing utility</span>
                                <h2 class="display-title">Clipboard improvement without the ceremony.</h2>
                                <p>Choose a provider, shape the output with prompts, and trigger rewrites with a deliberate triple-copy gesture.</p>
                            </div>
                        </div>

                        <div class="about-meta fade-up">
                            <article class="panel-card">
                                <span class="section-kicker">Version</span>
                                <h3>{version}</h3>
                                <p>The currently running desktop build on this machine.</p>
                            </article>
                            <article class="panel-card">
                                <span class="section-kicker">Providers</span>
                                <h3>PasteAI, OpenAI, Ollama, or Apple</h3>
                                <p>A managed account, your own API key, a local model, or on-device Apple Intelligence.</p>
                            </article>
                        </div>

                        <div class="about-links fade-up">
                            <a href="https://github.com/LimTec-de/pasteAi" class="app-button app-button--primary" target="_blank">View on GitHub</a>
                            <a href="https://github.com/LimTec-de/pasteAi/blob/master/LEGAL.md" class="app-button app-button--secondary" target="_blank">Legal</a>
                            <a href="https://www.limtec.de/#imprint" class="app-button app-button--ghost" target="_blank">Imprint</a>
                            <a href="https://openai.com/policies/terms-of-use" class="app-button app-button--ghost" target="_blank">OpenAI terms</a>
                        </div>
                    </div>
                </section>
            </section>
        </div>
    </main>
</WindowShell>
