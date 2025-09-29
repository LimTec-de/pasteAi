import { SettingsManager } from './services/settings';
import { SettingsStore } from './services/settings-store';
import { getUIElements } from './services/settings-ui';
import { PromptStore } from './services/prompt-store';
import { Window, PhysicalPosition } from '@tauri-apps/api/window';

async function initializeUI(): Promise<void> {
    try {
        console.log('Initializing settings UI...');
        await SettingsStore.initialize();
        await PromptStore.initialize();
        console.log('Store initialized');

        const elements = getUIElements();
        console.log('UI elements found');

        const settingsManager = new SettingsManager(elements);
        console.log('Settings manager created');

        await settingsManager.loadExistingSettings();
        console.log('Existing settings loaded');

        // Initialize window movement
        initializeWindowMovement();
    } catch (error) {
        console.error('Failed to initialize settings:', error);
        // Show error to user
        const errorDiv = document.createElement('div');
        errorDiv.style.color = 'red';
        errorDiv.style.padding = '20px';
        errorDiv.textContent = `Error initializing settings: ${error instanceof Error ? error.message : String(error)}`;
        document.body.prepend(errorDiv);
    }
}

function initializeWindowMovement(): void {
    const windowHeader = document.querySelector('.window-header') as HTMLElement;
    if (!windowHeader) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;

    windowHeader.addEventListener('mousedown', async (e) => {
        isDragging = true;
        const position = await Window.getCurrent().outerPosition();
        startX = e.clientX - position.x;
        startY = e.clientY - position.y;
    });

    window.addEventListener('mousemove', async (e) => {
        if (!isDragging) return;

        await Window.getCurrent().setPosition(new PhysicalPosition(e.clientX - startX, e.clientY - startY));
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // Handle close button
    const closeButton = document.getElementById('closeButton');
    if (closeButton) {
        closeButton.addEventListener('click', async () => {
            await Window.getCurrent().close();
        });
    }
}

window.addEventListener("DOMContentLoaded", () => {
    console.log('DOM loaded, initializing...');
    initializeUI();
});
