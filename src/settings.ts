import { load } from '@tauri-apps/plugin-store';
import { Window } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { Command } from '@tauri-apps/plugin-shell';
import { fetch } from '@tauri-apps/plugin-http';


async function fetchOllamaModels(url: string): Promise<string[]> {
    try {
        const response = await fetch(`${url}/api/tags`, {
            method: 'GET',
        });
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
        const response = await fetch(`${url}/api/version`, {
            method: 'GET',
        });
        return response.status === 200;
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
    const pasteAISettings = document.getElementById('pasteAISettings') as HTMLDivElement;

    // Hide all settings sections first
    ollamaSettings.style.display = 'none';
    ollamaModelSettings.style.display = 'none';
    apiKeyGroup.style.display = 'none';
    pasteAISettings.style.display = 'none';

    // Show relevant sections based on selected LLM type
    switch (llmTypeSelect?.value) {
        case 'ollama':
            ollamaSettings.style.display = 'block';
            ollamaModelSettings.style.display = 'block';
            const isAvailable = await checkOllamaAvailability(ollamaUrl.value);
            ollamaStatus.style.display = isAvailable ? 'none' : 'block';
            if (isAvailable) {
                await updateModelList();
            }
            break;
        case 'pasteai':
            pasteAISettings.style.display = 'block';
            break;
        case 'openai':
            apiKeyGroup.style.display = 'block';
            break;
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

async function checkQuota(appId: string, loginMessage: HTMLDivElement) {
    try {
        const quotaResponse = await fetch(`https://api.pasteai.app/quota/${appId}`, {
            method: 'GET',
        });
        const quotaData = await quotaResponse.json();

        if (quotaData.status === 'ok') {
            loginMessage.style.display = 'block';
            loginMessage.style.color = '#008000';
            loginMessage.textContent = `Your balance: ${quotaData.data.balance} sentences`;
            // Ensure parent element is visible
            const pasteAISettings = document.getElementById('pasteAISettings');
            if (pasteAISettings) {
                pasteAISettings.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error checking quota:', error);
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
    const loginButton = document.getElementById('loginButton') as HTMLButtonElement;
    const loginMessage = document.getElementById('loginMessage') as HTMLDivElement;
    const emailInput = document.getElementById('pasteAIEmail') as HTMLInputElement;

    if (!saveButton || !apiKeyInput || !systemPromptInput || !ollamaUrl || !modelSelect || !installPhiButton || !loginButton || !loginMessage || !emailInput) {
        console.error('Required elements not found');
        return;
    }

    // Check quota on initialization
    const store = await load('store.json', { autoSave: false });
    const appId = await store.get('appId') as string;
    if (appId) {
        await checkQuota(appId, loginMessage);
    }

    loginButton.addEventListener('click', async () => {
        const email = emailInput.value.trim();
        if (!email) {
            loginMessage.style.display = 'block';
            loginMessage.style.color = '#ff0000';
            loginMessage.textContent = '⚠️ Please enter an email address';
            return;
        }

        loginButton.disabled = true;
        loginMessage.style.display = 'block';
        loginMessage.style.color = '#666';
        loginMessage.textContent = 'Sending verification email...';

        try {
            const store = await load('store.json', { autoSave: false });
            const appId = await store.get('appId') as string;

            // Save email and llmType
            await store.set('email', email);
            await store.set('llm_type', llmTypeSelect.value);
            await store.save();

            const response = await fetch(`https://api.pasteai.app/login/${email}/${appId}`, {
                method: 'GET',
            });
            const data = await response.json();

            if (data.status === 'ok') {
                // Check quota after successful login
                loginMessage.style.display = 'block';
                loginMessage.style.color = '#008000';
                loginMessage.textContent = data.data.message;
            } else {
                loginMessage.style.color = '#ff0000';
                loginMessage.textContent = `⚠️ ${data.data.message || 'An error occurred'}`;
            }
        } catch (error) {
            loginMessage.style.color = '#ff0000';
            loginMessage.textContent = '⚠️ Failed to send verification email';
            console.error('Login error:', error);
        } finally {
            loginButton.disabled = false;
        }
    });

    // Load existing settings
    try {
        console.debug('Attempting to load existing settings');
        const store = await load('store.json', { autoSave: false });

        const savedLlmType = await store.get('llm_type') as string || 'pasteai';
        if (savedLlmType) {
            llmTypeSelect.value = savedLlmType;
        }

        const savedEmail = await store.get('email') as string;
        if (savedEmail) {
            emailInput.value = savedEmail;
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
