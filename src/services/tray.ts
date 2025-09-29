import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu, PredefinedMenuItem, Submenu, MenuItem, CheckMenuItem } from '@tauri-apps/api/menu';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { enable, isEnabled, disable } from '@tauri-apps/plugin-autostart';
import { exit } from '@tauri-apps/plugin-process';
import { Window } from '@tauri-apps/api/window';
import { CONFIG } from '../config';
import { WindowManager, UpdateManager } from '.';
import { PromptStore } from './prompt-store';

interface Prompt {
    id: number;
    title: string;
    prompt: string;
}


export class TrayManager {
    private static currentMenu: Menu | null = null;
    private static trayIcon: TrayIcon | null = null;

    static async initialize() {
        const isAutoStartEnabled = await isEnabled();
        this.currentMenu = await this.createMenu(isAutoStartEnabled);

        const options = {
            tooltip: CONFIG.APP_NAME,
            menu: this.currentMenu,
            menuOnLeftClick: true,
            icon: await defaultWindowIcon() ?? '',
            action: (event: any) => {
                switch (event.type) {
                    case 'Click':
                        console.log(
                            `mouse ${event.button} button pressed, state: ${event.buttonState}`
                        );
                        break;
                    case 'DoubleClick':
                        console.log(`mouse ${event.button} button pressed`);
                        break;
                    case 'Enter':
                        console.log(
                            `mouse hovered tray at ${event.rect.position.x}, ${event.rect.position.y}`
                        );
                        break;
                    case 'Move':
                        console.log(
                            `mouse moved on tray at ${event.rect.position.x}, ${event.rect.position.y}`
                        );
                        break;
                    case 'Leave':
                        console.log(
                            `mouse left tray at ${event.rect.position.x}, ${event.rect.position.y}`
                        );
                        break;
                }
            }
        };

        this.trayIcon = await TrayIcon.new(options);
    }

    private static async createMenu(isAutoStartEnabled: boolean) {
        const prompts = await PromptStore.getAllPrompts();
        const defaultPromptId = await PromptStore.getDefaultPromptId();

        const promptItems = [
            // "Choose every time" option
            await CheckMenuItem.new({
                id: 'choose_every_time',
                text: 'Choose every time',
                checked: defaultPromptId === "",
                action: async () => {
                    await PromptStore.setDefaultPromptId("");
                    await this.refreshMenu();
                },
            }),
            await PredefinedMenuItem.new({ item: 'Separator' }),
            // All available prompts
            ...(await Promise.all(prompts.map(async (prompt: Prompt) => await CheckMenuItem.new({
                id: `prompt_${prompt.id}`,
                text: prompt.title,
                checked: defaultPromptId === prompt.id.toString(),
                action: async () => {
                    await PromptStore.setDefaultPromptId(prompt.id.toString());
                    await this.refreshMenu();
                },
            }))))
        ];

        const promptSubmenu = await Submenu.new({
            text: 'Default Prompt',
            items: promptItems
        });

        return await Menu.new({
            items: [
                // Primary actions
                {
                    id: 'start',
                    text: 'How to use',
                    action: () => WindowManager.openStart(),
                },
                {
                    id: 'settings',
                    text: 'Settings',
                    action: () => WindowManager.openSettings(),
                },
                await PredefinedMenuItem.new({ item: 'Separator' }),
                // Configuration options
                promptSubmenu,
                await PredefinedMenuItem.new({ item: 'Separator' }),
                // Help & Support
                {
                    id: 'checkUpdates',
                    text: 'Check for Updates...',
                    action: async () => {
                        await UpdateManager.checkUpdate(true);
                    }
                },
                {
                    id: 'about',
                    text: 'About',
                    action: () => WindowManager.openAbout(),
                },
                {
                    id: 'autostart',
                    text: 'Start with system',
                    checked: isAutoStartEnabled,
                    action: async () => {
                        await this.toggleAutostart();
                    },
                },
                await PredefinedMenuItem.new({ item: 'Separator' }),
                // Debug/Developer options
                {
                    id: 'debug',
                    text: 'Show debug window',
                    action: () => Window.getCurrent().show(),
                },
                await PredefinedMenuItem.new({ item: 'Separator' }),
                // Exit
                {
                    id: 'quit',
                    text: 'Quit',
                    action: () => exit(0),
                },
            ],
        });
    }

    private static async toggleAutostart() {
        if (!this.currentMenu) return;

        const isAutoStartEnabled = await this.isAutoStartEnabled();

        if (isAutoStartEnabled) {
            await disable();
            const menuItem = await this.currentMenu.get('autostart');
            if (menuItem) await menuItem.setText('Enable Autostart');
        } else {
            await enable();
            const menuItem = await this.currentMenu.get('autostart');
            if (menuItem) await menuItem.setText('Disable Autostart');
        }
    }

    private static async isAutoStartEnabled(): Promise<boolean> {
        return await isEnabled();
    }

    private static async refreshMenu() {
        if (!this.trayIcon) return;

        const isAutoStartEnabled = await isEnabled();
        const newMenu = await this.createMenu(isAutoStartEnabled);

        // Update the tray with the new menu
        await this.trayIcon.setMenu(newMenu);
        this.currentMenu = newMenu;
    }
} 