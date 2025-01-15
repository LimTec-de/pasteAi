import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { enable, isEnabled, disable } from '@tauri-apps/plugin-autostart';
import { exit } from '@tauri-apps/plugin-process';
import { Window } from '@tauri-apps/api/window';
import { CONFIG } from '../config';
import { WindowManager, UpdateManager } from '.';

export class TrayManager {
    private static currentMenu: Menu | null = null;

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

        await TrayIcon.new(options);
    }

    private static async createMenu(isAutoStartEnabled: boolean) {
        return await Menu.new({
            items: [
                {
                    id: 'autostart',
                    text: 'Start with system',
                    checked: isAutoStartEnabled,
                    action: async () => {
                        await this.toggleAutostart();
                    },
                },
                await PredefinedMenuItem.new({ item: 'Separator' }),
                {
                    id: 'checkUpdates',
                    text: 'Check for Updates...',
                    action: async () => {
                        await UpdateManager.checkUpdate(true);
                    }
                },
                {
                    id: 'settings',
                    text: 'Settings',
                    action: () => WindowManager.openSettings(),
                },
                {
                    id: 'about',
                    text: 'About',
                    action: () => WindowManager.openAbout(),
                },
                await PredefinedMenuItem.new({ item: 'Separator' }),
                {
                    id: 'debug',
                    text: 'Show debug window',
                    action: () => Window.getCurrent().show(),
                },
                await PredefinedMenuItem.new({ item: 'Separator' }),
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
} 