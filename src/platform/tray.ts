import { defaultWindowIcon } from '@tauri-apps/api/app';
import { CheckMenuItem, Menu, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { TrayIcon } from '@tauri-apps/api/tray';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { exit } from '@tauri-apps/plugin-process';
import { AppWindows } from './windows';
import { PromptRepository } from '../domain/prompt-repository';
import { UpdateService } from './updates';

export class TrayController {
    private trayIcon: TrayIcon | null = null;
    private currentMenu: Menu | null = null;

    constructor(
        private readonly promptRepository: PromptRepository,
        private readonly windows: AppWindows,
        private readonly updates: UpdateService
    ) {}

    async initialize(): Promise<void> {
        const menu = await this.createMenu(await isEnabled());
        this.currentMenu = menu;
        this.trayIcon = await TrayIcon.new({
            tooltip: 'pasteAI',
            menu,
            menuOnLeftClick: true,
            icon: await defaultWindowIcon() ?? ''
        });
    }

    async refreshMenu(): Promise<void> {
        if (!this.trayIcon) {
            return;
        }

        const menu = await this.createMenu(await isEnabled());
        await this.trayIcon.setMenu(menu);
        this.currentMenu = menu;
    }

    private async createMenu(isAutoStartEnabled: boolean): Promise<Menu> {
        const prompts = await this.promptRepository.getAllPrompts();
        const defaultPromptId = await this.promptRepository.getDefaultPromptId();

        const promptItems = [
            await CheckMenuItem.new({
                id: 'choose_every_time',
                text: 'Choose every time',
                checked: defaultPromptId === null,
                action: async () => {
                    await this.promptRepository.setDefaultPromptId(null);
                    await this.windows.prewarmPromptWindow();
                    await this.refreshMenu();
                }
            }),
            await PredefinedMenuItem.new({ item: 'Separator' }),
            ...(await Promise.all(prompts.map(async (prompt) => (
                CheckMenuItem.new({
                    id: `prompt_${prompt.id}`,
                    text: prompt.title,
                    checked: defaultPromptId === prompt.id,
                    action: async () => {
                        await this.promptRepository.setDefaultPromptId(prompt.id);
                        await this.refreshMenu();
                    }
                })
            ))))
        ];

        const defaultPromptSubmenu = await Submenu.new({
            text: 'Default Prompt',
            items: promptItems
        });

        return Menu.new({
            items: [
                {
                    id: 'welcome',
                    text: 'How to use',
                    action: () => this.windows.openDashboard('welcome')
                },
                {
                    id: 'settings',
                    text: 'Settings',
                    action: () => this.windows.openDashboard('providers')
                },
                {
                    id: 'about',
                    text: 'About',
                    action: () => this.windows.openDashboard('about')
                },
                await PredefinedMenuItem.new({ item: 'Separator' }),
                defaultPromptSubmenu,
                await PredefinedMenuItem.new({ item: 'Separator' }),
                {
                    id: 'check_updates',
                    text: 'Check for Updates...',
                    action: () => this.updates.checkForUpdates(true)
                },
                {
                    id: 'autostart',
                    text: 'Start with system',
                    checked: isAutoStartEnabled,
                    action: () => this.toggleAutostart()
                },
                await PredefinedMenuItem.new({ item: 'Separator' }),
                {
                    id: 'quit',
                    text: 'Quit',
                    action: () => exit(0)
                }
            ]
        });
    }

    private async toggleAutostart(): Promise<void> {
        if (await isEnabled()) {
            await disable();
        } else {
            await enable();
        }

        await this.refreshMenu();
    }
}
