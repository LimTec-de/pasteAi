import { listen } from '@tauri-apps/api/event';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { APP_EVENTS } from './events';
import { AppStore } from '../domain/store';
import { SettingsRepository } from '../domain/settings-repository';
import { PromptRepository } from '../domain/prompt-repository';
import { ProviderGateway } from '../domain/provider-gateway';
import { DesktopNotifier } from '../platform/notifications';
import { UpdateService } from '../platform/updates';
import { AppWindows } from '../platform/windows';
import { TrayController } from '../platform/tray';
import { ClipboardImprover } from '../features/clipboard-improver';

export class AppRuntime {
    private readonly store = new AppStore();
    private readonly settings = new SettingsRepository(this.store);
    private readonly prompts = new PromptRepository(this.settings);
    private readonly notifier = new DesktopNotifier();
    private readonly windows = new AppWindows();
    private readonly providers = new ProviderGateway(this.settings, (title, body) => this.notifier.notify(title, body));
    private readonly updates = new UpdateService((title, body) => this.notifier.notify(title, body));
    private readonly tray = new TrayController(this.prompts, this.windows, this.updates);
    private readonly clipboard = new ClipboardImprover(this.prompts, this.providers, this.windows);

    async start(): Promise<void> {
        await this.settings.initialize();
        await this.prompts.initialize();
        await this.settings.ensureAppId();
        await this.ensureNotificationPermission();
        await this.windows.initialize();
        await this.registerEventHandlers();
        await this.tray.initialize();
        await this.providers.warmup();
        await this.clipboard.start();

        const settings = await this.settings.getAll();
        void this.windows.prewarmStatusWindow().catch((error) => {
            console.error('Failed to prewarm status window:', error);
        });

        if (!await this.prompts.getDefaultPrompt()) {
            void this.windows.prewarmPromptWindow().catch((error) => {
                console.error('Failed to prewarm prompt window:', error);
            });
        }

        if (settings.showStart) {
            void this.windows.openDashboard('welcome').catch((error) => {
                console.error('Failed to open dashboard window:', error);
            });
        }

        void this.updates.checkForUpdates(false);
    }

    private async registerEventHandlers(): Promise<void> {
        await listen(APP_EVENTS.SETTINGS_CHANGED, async () => {
            await this.settings.reload();
            await this.providers.warmup();
        });

        await listen(APP_EVENTS.PROMPTS_CHANGED, async () => {
            await this.settings.reload();
            await this.tray.refreshMenu();

            if (!await this.prompts.getDefaultPrompt()) {
                await this.windows.prewarmPromptWindow();
            }
        });
    }

    private async ensureNotificationPermission(): Promise<void> {
        const permissionGranted = await isPermissionGranted();
        if (permissionGranted) {
            return;
        }

        const permission = await requestPermission();
        if (permission !== 'granted') {
            console.warn('Notification permission not granted');
        }
    }
}

export function createAppRuntime(): AppRuntime {
    return new AppRuntime();
}
