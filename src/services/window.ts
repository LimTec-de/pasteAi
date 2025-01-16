import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Window } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/window';
import { WINDOW_CONFIG, WindowConfig } from '../config';

export class WindowManager {
    static async createWindow(type: keyof WindowConfig, url: string) {
        const config = WINDOW_CONFIG[type];
        const newWindow = new WebviewWindow(type, {
            url: `/${url}.html`,
            title: config.title,
            width: config.width,
            height: config.height,
            resizable: false,
            alwaysOnTop: true,
        });

        newWindow.once('tauri://created', () => {
            console.log(`${type} window created`);
        });

        newWindow.once('tauri://error', (error) => {
            console.error(`Failed to create ${type} window:`, error);
        });

        return newWindow;
    }

    static async openSettings() {
        return this.createWindow('settings', 'settings');
    }

    static async openAbout() {
        return this.createWindow('about', 'about');
    }

    static async openStart() {
        return this.createWindow('start', 'start');
    }
}

export enum StatusType {
    ERROR = 'error',
    OK = 'ok',
    WORKING = 'working',
    INFO = 'info'
}

export class StatusWindow {
    private static hideTimeout: number | null = null;

    static async display(message: string, type: StatusType = StatusType.INFO) {
        const mainWindow = Window.getCurrent();
        if (!mainWindow) return;

        await mainWindow.show();

        const statusElement = document.getElementById('status-message');
        if (!statusElement) return;

        statusElement.textContent = message;
        statusElement.style.display = 'block';
        statusElement.className = `status-${type}`;

        await new Promise(resolve => setTimeout(resolve, 50));

        const rect = statusElement.getBoundingClientRect();
        const padding = 40;

        const newSize = new LogicalSize(
            Math.min(Math.max(rect.width + padding, 300), 800),
            Math.min(rect.height + padding, 400)
        );
        await mainWindow.setSize(newSize);

        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
        }
        this.hideTimeout = setTimeout(async () => {
            const element = document.getElementById('status-message');
            if (element) {
                element.style.display = 'none';
            }
            await mainWindow.hide();
        }, type === StatusType.ERROR ? 10000 : 1000);
    }
} 