import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Window } from '@tauri-apps/api/window';
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
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

    static async openStatus() {
        const statusWindow = new WebviewWindow('status', {
            url: '/status.html',
            title: 'Status',
            width: 400,
            height: 80,
            resizable: false,
            alwaysOnTop: true,
            transparent: true,
            decorations: false,
            skipTaskbar: true,
            visible: false, // Start hidden
        });

        statusWindow.once('tauri://created', () => {
            console.log('Status window created');
        });

        statusWindow.once('tauri://error', (error) => {
            console.error('Failed to create status window:', error);
        });

        return statusWindow;
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
    private static statusWindow: WebviewWindow | null = null;

    static async display(message: string, type: StatusType = StatusType.INFO, autohide: boolean = true) {
        // Create status window if it doesn't exist
        if (!this.statusWindow) {
            this.statusWindow = await WindowManager.openStatus();
            // Wait a bit for the window to be ready
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Send display event to status window
        await this.statusWindow.emit('status-display', { message, type, autohide });

        // Show the status window
        await this.statusWindow.show();
    }

    static async hide() {
        if (this.statusWindow) {
            await this.statusWindow.emit('status-hide');
        }
    }

    static async destroy() {
        if (this.statusWindow) {
            await this.statusWindow.close();
            this.statusWindow = null;
        }
    }
} 