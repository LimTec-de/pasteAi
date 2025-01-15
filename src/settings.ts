import { SettingsManager } from './services/settings';
import { SettingsStore } from './services/settings-store';
import { getUIElements } from './utils/settings-ui';

async function initializeUI(): Promise<void> {
    try {
        console.log('Initializing settings UI...');
        await SettingsStore.initialize();
        console.log('Store initialized');

        const elements = getUIElements();
        console.log('UI elements found');

        const settingsManager = new SettingsManager(elements);
        console.log('Settings manager created');

        await settingsManager.loadExistingSettings();
        console.log('Existing settings loaded');
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

window.addEventListener("DOMContentLoaded", () => {
    console.log('DOM loaded, initializing...');
    initializeUI();
});
