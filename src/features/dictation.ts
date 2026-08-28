import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import clipboard from 'tauri-plugin-clipboard-api';
import { APP_EVENTS, type DictateCommitPayload } from '../app/events';
import { CONFIG } from '../config';
import { ProviderGateway } from '../domain/provider-gateway';
import { SettingsRepository } from '../domain/settings-repository';
import { cancelAppleDictation, getAppleSpeechAvailability, startAppleDictation } from '../domain/apple-system';
import type { StatusType } from '../domain/types';
import { transcriptionLanguages } from '../domain/types';
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
    }

    async reregister(): Promise<void> {
        await this.registerFromSettings();
    }

    private async registerFromSettings(): Promise<void> {
        const shortcut = (await this.settingsRepository.get('dictateShortcut')).trim()
            || CONFIG.DEFAULT_DICTATE_SHORTCUT;

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

            this.clipboardImprover.beginDictation();
            await this.windows.hideStatus();
            await invoke('remember_frontmost_app').catch((error) => {
                console.warn('Could not remember frontmost app:', error);
            });

            try {
                await startAppleDictation(languages, microphoneId);
                if (this.cancelled) {
                    await cancelAppleDictation().catch(() => undefined);
                    return;
                }

                await this.windows.showDictate({
                    engine: 'apple',
                    shortcut,
                    languages,
                    microphoneId,
                    outputMode
                });
                await invoke('restore_frontmost_app').catch((error) => {
                    console.warn('Could not restore frontmost app:', error);
                });

                if (!this.holdIntent && !this.cancelled && !this.latched) {
                    await this.windows.requestDictateFinish();
                }
            } catch (error) {
                console.error('Could not start dictation:', error);
                this.holdIntent = false;
                this.latched = false;
                this.clipboardImprover.endDictation();
                await cancelAppleDictation().catch(() => undefined);
                await this.showStatus(
                    `Could not start dictation: ${error instanceof Error ? error.message : String(error)}`,
                    'error'
                );
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

        this.clipboardImprover.beginDictation();
        await this.windows.hideStatus();
        await invoke('remember_frontmost_app').catch((error) => {
            console.warn('Could not remember frontmost app:', error);
        });

        try {
            const clientSecret = await this.providerGateway.createTranscriptionClientSecret();
            if (this.cancelled) {
                return;
            }

            await this.windows.showDictate({
                engine: 'openai',
                clientSecret,
                shortcut,
                languages,
                microphoneId,
                outputMode
            });
            await invoke('restore_frontmost_app').catch((error) => {
                console.warn('Could not restore frontmost app:', error);
            });

            if (!this.holdIntent && !this.cancelled && !this.latched) {
                await this.windows.requestDictateFinish();
            }
        } catch (error) {
            console.error('Could not start dictation:', error);
            this.holdIntent = false;
            this.latched = false;
            this.clipboardImprover.endDictation();
            await this.showStatus(
                `Could not start dictation: ${error instanceof Error ? error.message : String(error)}`,
                'error'
            );
        }
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

        this.clipboardImprover.suppressNextWrite(transcript);
        await clipboard.writeText(transcript);

        const outputMode = await this.settingsRepository.get('dictateOutputMode');
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

    private async showStatus(message: string, type: StatusType): Promise<void> {
        await this.windows.showStatus({ message, type });
    }
}
