import { load } from '@tauri-apps/plugin-store';
import { Window } from '@tauri-apps/api/window';

async function initializeUI() {
    console.info('Initializing API Key page');
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
    const saveButton = document.getElementById('saveButton') as HTMLButtonElement;

    if (!saveButton || !apiKeyInput) {
        console.error('Required elements not found');
        return;
    }
    console.debug('All required elements found');

    // Load existing API key
    try {
        console.debug('Attempting to load existing API key');
        const store = await load('store.json', { autoSave: false });
        const openai_api_key: string = await store.get('openai_api_key') as string;
        if (openai_api_key) {
            apiKeyInput.value = openai_api_key;
            console.info('Existing API key loaded successfully');
        } else {
            console.info('No existing API key found');
        }
    } catch (error) {
        console.error('Error loading API key:', error);
    }

    saveButton.addEventListener('click', async () => {
        try {
            console.debug('Save button clicked');
            saveButton.disabled = true;

            const apiKey = apiKeyInput.value.trim();
            if (!apiKey) {
                console.warn('Empty API key submitted');
                return;
            }

            const store = await load('store.json', { autoSave: false });
            await store.set('openai_api_key', apiKey);
            await store.save();

            await (await Window.getByLabel('api-key'))?.close();

        } catch (error) {
            console.error('Error saving API key:', error);
            if (error instanceof Error) {
                console.error('Error details:', error.message);
            }
        }
    });
}
window.addEventListener("DOMContentLoaded", async () => {
    await initializeUI();
});
