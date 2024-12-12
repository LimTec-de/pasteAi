import { load } from '@tauri-apps/plugin-store';
import { Window } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { Command } from '@tauri-apps/plugin-shell';

async function fetchOllamaModels(url: string): Promise<string[]> {
    try {
        const response = await fetch(`${url}/api/tags`);
        if (!response.ok) return [];
        const data = await response.json();
        return data.models?.map((model: any) => model.name) || [];
    } catch (error) {
        console.error('Error fetching Ollama models:', error);
        return [];
    }
}

async function updateModelList() {
    const ollamaUrl = document.getElementById('ollamaUrl') as HTMLInputElement;
    const modelSelect = document.getElementById('ollamaModel') as HTMLSelectElement;
    const ollamaModelSettings = document.getElementById('ollamaModelSettings') as HTMLDivElement;

    if (!modelSelect || !ollamaUrl) return;

    const models = await fetchOllamaModels(ollamaUrl.value);
    modelSelect.innerHTML = '';

    if (models.length === 0) {
        modelSelect.innerHTML = '<option value="">No models found</option>';
    } else {
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            modelSelect.appendChild(option);
        });
    }

    // Restore selected model if exists
    const store = await load('store.json', { autoSave: false });
    const savedModel = await store.get('ollama_model') as string;
    if (savedModel && models.includes(savedModel)) {
        modelSelect.value = savedModel;
    }
}

async function checkOllamaAvailability(url: string): Promise<boolean> {
    try {
        const response = await fetch(`${url}/api/version`);
        return response.ok;
    } catch (error) {
        console.error('Error checking Ollama availability:', error);
        return false;
    }
}

async function updateOllamaStatus() {
    const llmTypeSelect = document.getElementById('llmType') as HTMLSelectElement;
    const ollamaSettings = document.getElementById('ollamaSettings') as HTMLDivElement;
    const ollamaModelSettings = document.getElementById('ollamaModelSettings') as HTMLDivElement;
    const ollamaStatus = document.getElementById('ollamaStatus') as HTMLDivElement;
    const ollamaUrl = document.getElementById('ollamaUrl') as HTMLInputElement;
    const apiKeyGroup = document.querySelector('.input-group:has(#apiKey)') as HTMLDivElement;

    if (llmTypeSelect?.value === 'ollama') {
        ollamaSettings.style.display = 'block';
        ollamaModelSettings.style.display = 'block';
        apiKeyGroup.style.display = 'none';

        const isAvailable = await checkOllamaAvailability(ollamaUrl.value);
        ollamaStatus.style.display = isAvailable ? 'none' : 'block';

        if (isAvailable) {
            await updateModelList();
        }
    } else {
        ollamaSettings.style.display = 'none';
        ollamaModelSettings.style.display = 'none';
        apiKeyGroup.style.display = 'block';
        ollamaStatus.style.display = 'none';
    }
}

async function installPhiModel() {
    const installButton = document.getElementById('installPhi') as HTMLButtonElement;
    const outputPre = document.getElementById('installOutput') as HTMLPreElement;

    installButton.disabled = true;
    outputPre.style.display = 'block';
    outputPre.textContent = 'Installing phi:mini...\n';

    try {
        const command = Command.create('ollama', ['pull', 'phi3:mini']);

        command.on('close', async ({ code }) => {
            if (code === 0) {
                outputPre.textContent += '\nInstallation complete!';
                await updateModelList();
            } else {
                outputPre.textContent += `\nProcess exited with code ${code}`;
            }
            installButton.disabled = false;
        });

        command.on('error', error => {
            outputPre.textContent += `\nError: ${error}`;
            installButton.disabled = false;
        });

        command.stdout.on('data', line => {
            outputPre.textContent += line + '\n';
            outputPre.scrollTop = outputPre.scrollHeight;
        });

        command.stderr.on('data', line => {
            outputPre.textContent += line + '\n';
            outputPre.scrollTop = outputPre.scrollHeight;
        });

        await command.spawn();
    } catch (error) {
        outputPre.textContent += `\nError: ${error}`;
        installButton.disabled = false;
    }
}

async function initializeUI() {
    console.info('Initializing settings page');
    const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
    const systemPromptInput = document.getElementById('systemPrompt') as HTMLTextAreaElement;
    const saveButton = document.getElementById('saveButton') as HTMLButtonElement;
    const ollamaUrl = document.getElementById('ollamaUrl') as HTMLInputElement;
    const modelSelect = document.getElementById('ollamaModel') as HTMLSelectElement;
    const installPhiButton = document.getElementById('installPhi') as HTMLButtonElement;
    const llmTypeSelect = document.getElementById('llmType') as HTMLSelectElement;

    if (!saveButton || !apiKeyInput || !systemPromptInput || !ollamaUrl || !modelSelect || !installPhiButton) {
        console.error('Required elements not found');
        return;
    }

    // Load existing settings
    try {
        console.debug('Attempting to load existing settings');
        const store = await load('store.json', { autoSave: false });

        const savedLlmType = await store.get('llm_type') as string || 'ollama';
        if (savedLlmType) {
            llmTypeSelect.value = savedLlmType;
        }

        const savedOllamaUrl = await store.get('ollama_url') as string;
        if (savedOllamaUrl) {
            ollamaUrl.value = savedOllamaUrl;
        }

        const openai_api_key: string = await store.get('openai_api_key') as string;
        if (openai_api_key) {
            apiKeyInput.value = openai_api_key;
        }

        const systemPrompt = await invoke('get_system_prompt_from_settings');
        if (systemPrompt) {
            systemPromptInput.value = systemPrompt as string;
        }

        await updateOllamaStatus();
    } catch (error) {
        console.error('Error loading settings:', error);
    }

    llmTypeSelect.addEventListener('change', updateOllamaStatus);
    ollamaUrl.addEventListener('change', updateOllamaStatus);
    installPhiButton.addEventListener('click', installPhiModel);

    saveButton.addEventListener('click', async () => {
        try {
            console.debug('Save button clicked');
            saveButton.disabled = true;

            const store = await load('store.json', { autoSave: false });

            await store.set('llm_type', llmTypeSelect.value);
            await store.set('ollama_url', ollamaUrl.value);
            await store.set('ollama_model', modelSelect.value);

            if (llmTypeSelect.value === 'openai') {
                const apiKey = apiKeyInput.value.trim();
                if (!apiKey) {
                    console.warn('Empty API key submitted');
                    return;
                }
                await store.set('openai_api_key', apiKey);
            }

            const systemPrompt = systemPromptInput.value.trim();
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
