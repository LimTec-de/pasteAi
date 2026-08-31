import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import clipboard from 'tauri-plugin-clipboard-api';
import { APP_EVENTS, type DictateCommitPayload } from '../app/events';
import { CONFIG } from '../config';
import { ProviderGateway } from '../domain/provider-gateway';
import { PromptRepository } from '../domain/prompt-repository';
import { SettingsRepository } from '../domain/settings-repository';
import { cancelAppleDictation, getAppleSpeechAvailability, startAppleDictation } from '../domain/apple-system';
import { getLocalSttStatus, preloadLocalStt } from '../domain/local-stt';
import { isLocalLlmMissing } from '../domain/local-llm';
import type { StatusType } from '../domain/types';
import { transcriptionLanguages } from '../domain/types';
import { applyReplacements, dictionaryPromptSuffix, transcriptionKeywords, transcriptionPrompt } from '../domain/dictate-dictionary';
import { isForbiddenDictateShortcut } from '../platform/shortcut';
import { AppWindows } from '../platform/windows';
import { ClipboardImprover } from './clipboard-improver';

const TAP_MS = 450;

export class DictationController {
    private registeredShortcut: string | null = null;
    private holdIntent = false;
    private latched = false;
    private stoppingLatch = false;
    private cancelled = false;
    private pressAt = 0;
    private starting: Promise<void> | null = null;

    constructor(
        private readonly settingsRepository: SettingsRepository,
        private readonly promptRepository: PromptRepository,
        private readonly providerGateway: ProviderGateway,
        private readonly windows: AppWindows,
        private readonly clipboardImprover: ClipboardImprover
    ) {}

    async start(): Promise<void> {
        await listen<DictateCommitPayload>(APP_EVENTS.DICTATE_COMMIT, (event) => {
            void this.handleCommit(event.payload);
        });
        await listen(APP_EVENTS.DICTATE_CANCEL, () => {
            void this.handleCancel();
        });
        await this.registerFromSettings();
        await this.preloadLocalIfNeeded();
    }

    async reregister(): Promise<void> {
        await this.registerFromSettings();
        await this.preloadLocalIfNeeded();
    }

    private async preloadLocalIfNeeded(): Promise<void> {
        const provider = await this.settingsRepository.get('dictationProvider');
        if (provider !== 'local') {
            return;
        }

        void preloadLocalStt().catch((error) => {
            console.warn('Could not preload local speech model:', error);
        });
    }

    private async registerFromSettings(): Promise<void> {
        const shortcut = (await this.settingsRepository.get('dictateShortcut')).trim()
            || CONFIG.DEFAULT_DICTATE_SHORTCUT;

        if (isForbiddenDictateShortcut(shortcut)) {
            await this.unregisterCurrent();
            await this.showStatus(
                'Command or Control plus a single key is already a menu shortcut. Add Shift or Alt under Dictation.',
                'error'
            );
            return;
        }

        if (this.registeredShortcut === shortcut) {
            return;
        }

        await this.unregisterCurrent();

        try {
            await register(shortcut, (event) => {
                if (event.state === 'Pressed') {
                    void this.handlePressed();
                    return;
                }

                if (event.state === 'Released') {
                    void this.handleReleased();
                }
            });
            this.registeredShortcut = shortcut;
        } catch (error) {
            this.registeredShortcut = null;
            await this.showStatus(
                `Could not register dictate shortcut ${shortcut}: ${error instanceof Error ? error.message : String(error)}`,
                'error'
            );
        }
    }

    private async unregisterCurrent(): Promise<void> {
        if (!this.registeredShortcut) {
            return;
        }

        await unregister(this.registeredShortcut).catch(() => undefined);
        this.registeredShortcut = null;
    }

    private async handlePressed(): Promise<void> {
        if (this.latched) {
            this.latched = false;
            this.stoppingLatch = true;
            await this.windows.requestDictateFinish();
            return;
        }

        if (this.holdIntent || this.clipboardImprover.isBusy()) {
            return;
        }

        this.holdIntent = true;
        this.cancelled = false;
        this.pressAt = Date.now();
        this.starting = this.beginSession();
        void this.starting;
    }

    private async handleReleased(): Promise<void> {
        if (this.stoppingLatch) {
            this.stoppingLatch = false;
            return;
        }

        if (this.latched || !this.holdIntent) {
            return;
        }

        this.holdIntent = false;
        if (Date.now() - this.pressAt < TAP_MS) {
            this.latched = true;
        }

        if (this.starting) {
            await this.starting;
        }

        if (this.cancelled) {
            this.latched = false;
            return;
        }

        if (this.latched) {
            await this.windows.latchDictate();
            return;
        }

        await this.windows.requestDictateFinish();
    }

    private async beginSession(): Promise<void> {
        const settings = await this.settingsRepository.getAll();
        const shortcut = settings.dictateShortcut.trim() || CONFIG.DEFAULT_DICTATE_SHORTCUT;
        const languages = transcriptionLanguages(settings);
        const keywords = transcriptionKeywords(settings.dictateVocabulary, settings.dictateReplacements);
        const transcriptionHint = transcriptionPrompt(settings.dictateVocabulary, settings.dictateReplacements);
        const microphoneId = settings.dictateMicrophoneId.trim();
        const outputMode = settings.dictateOutputMode;

        if (settings.dictationProvider === 'apple') {
            const availability = await getAppleSpeechAvailability();
            if (!availability.available) {
                this.holdIntent = false;
                this.latched = false;
                await this.showStatus(availability.message, 'error');
                await this.windows.openDashboard('providers');
                return;
            }

            await this.openOverlay({
                engine: 'apple',
                shortcut,
                languages,
                keywords,
                transcriptionPrompt: transcriptionHint,
                microphoneId,
                outputMode
            });

            try {
                await startAppleDictation(languages, microphoneId);
                if (this.cancelled) {
                    await cancelAppleDictation().catch(() => undefined);
                    return;
                }

                await this.windows.markDictateReady();
                await this.finishIfReleased();
            } catch (error) {
                await this.failStart(error, () => cancelAppleDictation().catch(() => undefined));
            }
            return;
        }

        if (settings.dictationProvider === 'local') {
            const local = await getLocalSttStatus();
            if (!local.installed) {
                this.holdIntent = false;
                this.latched = false;
                await this.showStatus(
                    local.message || 'Download the on-device speech model first',
                    'error'
                );
                await this.windows.openDashboard('providers');
                return;
            }

            await this.openOverlay({
                engine: 'local',
                shortcut,
                languages,
                keywords,
                transcriptionPrompt: transcriptionHint,
                microphoneId,
                outputMode
            });

            try {
                await preloadLocalStt();
                if (this.cancelled) {
                    return;
                }

                await this.windows.markDictateReady();
                await this.finishIfReleased();
            } catch (error) {
                await this.failStart(error);
            }
            return;
        }

        const apiKey = settings.openaiApiKey.trim();
        if (!apiKey) {
            this.holdIntent = false;
            this.latched = false;
            await this.showStatus('Dictation needs an OpenAI API key', 'error');
            await this.windows.openDashboard('providers');
            return;
        }

        await this.openOverlay({
            engine: 'openai',
            shortcut,
            languages,
            keywords,
            transcriptionPrompt: transcriptionHint,
            microphoneId,
            outputMode
        });

        try {
            const clientSecret = await this.providerGateway.createTranscriptionClientSecret();
            if (this.cancelled) {
                return;
            }

            await this.windows.provideDictateSession(clientSecret);
            await this.finishIfReleased();
        } catch (error) {
            await this.failStart(error);
        }
    }

    private async openOverlay(payload: {
        engine: 'openai' | 'apple' | 'local';
        shortcut: string;
        languages: string[];
        keywords: string[];
        transcriptionPrompt: string;
        microphoneId: string;
        outputMode: 'insert' | 'clipboard';
    }): Promise<void> {
        this.clipboardImprover.beginDictation();
        await this.windows.hideStatus();
        await invoke('remember_frontmost_app').catch((error) => {
            console.warn('Could not remember frontmost app:', error);
        });
        await this.windows.showDictate(payload);
        await invoke('restore_frontmost_app').catch((error) => {
            console.warn('Could not restore frontmost app:', error);
        });
    }

    private async finishIfReleased(): Promise<void> {
        if (!this.holdIntent && !this.cancelled && !this.latched) {
            await this.windows.requestDictateFinish();
        }
    }

    private async failStart(error: unknown, cleanup?: () => Promise<void>): Promise<void> {
        console.error('Could not start dictation:', error);
        this.holdIntent = false;
        this.latched = false;
        this.clipboardImprover.endDictation();
        await cleanup?.();
        await this.windows.hideDictate();
        await this.showStatus(
            `Could not start dictation: ${error instanceof Error ? error.message : String(error)}`,
            'error'
        );
    }

    private async handleCommit(payload: DictateCommitPayload): Promise<void> {
        this.holdIntent = false;
        this.latched = false;
        this.stoppingLatch = false;
        await this.windows.hideDictate();

        if (payload.error) {
            this.clipboardImprover.endDictation();
            await invoke('restore_frontmost_app').catch((error) => {
                console.warn('Could not restore frontmost app:', error);
            });
            await this.showStatus(payload.error, 'error');
            return;
        }

        const transcript = payload.text.trim();

        if (transcript.length === 0) {
            this.clipboardImprover.endDictation();
            await invoke('restore_frontmost_app').catch((error) => {
                console.warn('Could not restore frontmost app:', error);
            });
            await this.showStatus('No speech detected', 'info');
            return;
        }

        let text = transcript;
        const settings = await this.settingsRepository.getAll();
        const prompt = await this.promptRepository.getDictatePrompt();
        if (prompt) {
            try {
                await this.showStatus('Improving...', 'working', { autohide: false });
                const suffix = dictionaryPromptSuffix(settings.dictateVocabulary, settings.dictateReplacements);
                const systemPrompt = suffix.length > 0 ? `${prompt.prompt}\n\n${suffix}` : prompt.prompt;
                text = await this.providerGateway.improve(transcript, systemPrompt);
            } catch (error) {
                console.error('Could not improve dictation:', error);
                this.clipboardImprover.endDictation();
                await invoke('restore_frontmost_app').catch((restoreError) => {
                    console.warn('Could not restore frontmost app:', restoreError);
                });

                const providerError = error as Error & { data?: { type?: string } };
                if (providerError.data?.type === 'quota') {
                    await this.showStatus(
                        'No tokens left! <a href="https://pasteai.app/tokens.html" target="_blank">Click here to recharge</a>',
                        'error',
                        { allowHtml: true }
                    );
                } else {
                    if (isLocalLlmMissing(error)) {
                        await this.windows.openDashboard('providers');
                    }
                    await this.showStatus(
                        `Could not improve sentence, please check your settings: ${error instanceof Error ? error.message : String(error)}`,
                        'error'
                    );
                }
                return;
            }
        }

        text = applyReplacements(text, settings.dictateReplacements);

        this.clipboardImprover.suppressNextWrite(text);
        await clipboard.writeText(text);
        this.clipboardImprover.armDictionaryLearn(text);

        const outputMode = settings.dictateOutputMode;
        if (outputMode === 'clipboard') {
            await invoke('restore_frontmost_app').catch((error) => {
                console.warn('Could not restore frontmost app:', error);
            });
            await this.showStatus('Copied', 'ok');
            this.clipboardImprover.enterWriteCooldown();
            return;
        }

        try {
            await invoke('paste_into_frontmost');
            await this.showStatus('Inserted and copied', 'ok');
        } catch (error) {
            await this.showStatus(
                `Copied, but could not paste: ${error instanceof Error ? error.message : String(error)}`,
                'error'
            );
        }

        this.clipboardImprover.enterWriteCooldown();
    }

    private async handleCancel(): Promise<void> {
        this.cancelled = true;
        this.holdIntent = false;
        this.latched = false;
        this.stoppingLatch = false;
        await cancelAppleDictation().catch(() => undefined);
        await this.windows.hideDictate();
        this.clipboardImprover.endDictation();
        await invoke('restore_frontmost_app').catch((error) => {
            console.warn('Could not restore frontmost app:', error);
        });
    }

    private async showStatus(
        message: string,
        type: StatusType,
        options: { autohide?: boolean; allowHtml?: boolean } = {}
    ): Promise<void> {
        await this.windows.showStatus({
            message,
            type,
            autohide: options.autohide,
            allowHtml: options.allowHtml
        });
    }
}
