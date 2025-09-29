import { Window } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/window';

export enum StatusType {
    ERROR = 'error',
    OK = 'ok',
    WORKING = 'working',
    INFO = 'info'
}

class StatusWindowManager {
    private static hideTimeout: number | null = null;

    static async init() {
        // Listen for status display events from main window
        const currentWindow = Window.getCurrent();

        await currentWindow.listen('status-display', (event) => {
            const { message, type, autohide } = event.payload as {
                message: string;
                type: StatusType;
                autohide: boolean;
            };

            this.display(message, type, autohide);
        });

        await currentWindow.listen('status-hide', () => {
            this.hide();
        });
    }

    static async display(message: string, type: StatusType = StatusType.INFO, autohide: boolean = true) {
        const statusElement = document.getElementById('status-message');
        if (!statusElement) return;

        statusElement.innerHTML = message;
        statusElement.style.display = 'block';
        statusElement.className = `status-${type}`;

        // Wait for DOM update
        await new Promise(resolve => setTimeout(resolve, 50));

        // Size the window to fit the content
        const rect = statusElement.getBoundingClientRect();
        const padding = 40;

        const newSize = new LogicalSize(
            Math.min(Math.max(rect.width + padding, 320), 600),
            Math.min(rect.height + padding, 100)
        );

        const currentWindow = Window.getCurrent();
        await currentWindow.setSize(newSize);

        // Handle auto-hide timeout
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
        }

        if (autohide) {
            this.hideTimeout = window.setTimeout(async () => {
                this.hide();
            }, type === StatusType.ERROR ? 10000 : 1000);
        } else {
            this.hideTimeout = null;
        }
    }

    static async hide() {
        const statusElement = document.getElementById('status-message');
        if (statusElement) {
            statusElement.style.display = 'none';
        }

        const currentWindow = Window.getCurrent();
        await currentWindow.hide();
    }
}

// Initialize when the window loads
window.addEventListener('DOMContentLoaded', () => {
    StatusWindowManager.init();
});
