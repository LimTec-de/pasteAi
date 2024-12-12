import { load } from '@tauri-apps/plugin-store';
import { Window } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

async function initializeUI() {
    console.info('Initializing API Key page');
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
    const systemPromptInput = document.getElementById('systemPrompt') as HTMLTextAreaElement;
    const saveButton = document.getElementById('saveButton') as HTMLButtonElement;

    if (!saveButton || !apiKeyInput || !systemPromptInput) {
        console.error('Required elements not found');
        return;
    }
    console.debug('All required elements found');

    // Load existing API key and system prompt
    try {
        console.debug('Attempting to load existing settings');
        const store = await load('store.json', { autoSave: false });
        const openai_api_key: string = await store.get('openai_api_key') as string;
        if (openai_api_key) {
            apiKeyInput.value = openai_api_key;
            console.info('Existing API key loaded successfully');
        }

        const systemPrompt = await invoke('get_system_prompt_from_settings');
        if (systemPrompt) {
            systemPromptInput.value = systemPrompt as string;
            console.info('Existing system prompt loaded successfully');
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }

    saveButton.addEventListener('click', async () => {
        try {
            console.debug('Save button clicked');
            saveButton.disabled = true;

            const apiKey = apiKeyInput.value.trim();
            const systemPrompt = systemPromptInput.value.trim();

            if (!apiKey) {
                console.warn('Empty API key submitted');
                return;
            }

            const store = await load('store.json', { autoSave: false });
            await store.set('openai_api_key', apiKey);
            await store.save();


            await emit('settings-saved', { saved: true });

            await invoke('set_system_prompt_from_settings', { prompt: systemPrompt });

            await (await Window.getByLabel('settings'))?.close();

        } catch (error) {
            console.error('Error saving settings:', error);
            if (error instanceof Error) {
                console.error('Error details:', error.message);
            }
        }
    });
}
window.addEventListener("DOMContentLoaded", async () => {
    await initializeUI();
});
