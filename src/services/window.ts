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
            transparent: false,
            decorations: false,
            skipTaskbar: false,
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

    /**
     * Opens the prompt selector window and returns the selected prompt
     * @returns Promise with the selected prompt or null if canceled
     */
    static async openPromptSelector(): Promise<{ id: number; title: string; prompt: string } | null> {
        const promptSelectorWindow = await this.createWindow('prompt', 'prompt');

        return new Promise((resolve) => {
            // Listen for a custom event from the prompt selector window
            const unlisten = Window.getCurrent().listen('prompt-selected', (event) => {
                // Clean up the listener
                unlisten.then(fn => fn());

                // Close the window
                promptSelectorWindow.close();

                // Resolve with the selected prompt
                resolve(event.payload as { id: number; title: string; prompt: string } | null);
            });

            // Also listen for window close event in case user cancels
            promptSelectorWindow.once('tauri://destroyed', () => {
                // Clean up the listener
                unlisten.then(fn => fn());

                // Resolve with null if window was closed without selection
                resolve(null);
            });
        });
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

        statusElement.innerHTML = message;
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
        this.hideTimeout = window.setTimeout(async () => {
            const element = document.getElementById('status-message');
            if (element) {
                element.style.display = 'none';
            }
            await mainWindow.hide();
        }, type === StatusType.ERROR ? 10000 : 1000);
    }
} 