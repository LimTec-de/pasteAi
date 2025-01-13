import { load } from '@tauri-apps/plugin-store';
import { Window } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { Command } from '@tauri-apps/plugin-shell';
import { fetch } from '@tauri-apps/plugin-http';

// Types
interface UIElements {
    apiKeyInput: HTMLInputElement;
    systemPromptInput: HTMLTextAreaElement;
    saveButton: HTMLButtonElement;
    ollamaUrl: HTMLInputElement;
    modelSelect: HTMLSelectElement;
    installPhiButton: HTMLButtonElement;
    llmTypeSelect: HTMLSelectElement;
    loginButton: HTMLButtonElement;
    loginMessage: HTMLDivElement;
    emailInput: HTMLInputElement;
    ollamaSettings: HTMLDivElement;
    ollamaModelSettings: HTMLDivElement;
    ollamaStatus: HTMLDivElement;
    apiKeyGroup: HTMLDivElement;
    pasteAISettings: HTMLDivElement;
    checkQuotaButton: HTMLButtonElement;
    quotaDisplay: HTMLDivElement;
}

type LLMType = 'pasteai' | 'ollama' | 'openai';

// API Service
class APIService {
    static async fetchOllamaModels(url: string): Promise<string[]> {
        try {
            const response = await fetch(`${url}/api/tags`);
            const data = await response.json();
            return data.models?.map((model: any) => model.name) || [];
        } catch (error) {
            console.error('Error fetching Ollama models:', error);
            return [];
        }
    }

    static async checkOllamaAvailability(url: string): Promise<boolean> {
        try {
            const response = await fetch(`${url}/api/version`);
            return response.status === 200;
        } catch (error) {
            console.error('Error checking Ollama availability:', error);
            return false;
        }
    }

    static async checkQuota(appId: string): Promise<{ status: string; data: { balance: number } }> {
        const response = await fetch(`https://api.pasteai.app/quota/${appId}`);
        return response.json();
    }

    static async loginUser(email: string, appId: string): Promise<{ status: string; data: { message: string } }> {
        const response = await fetch(`https://api.pasteai.app/login/${email}/${appId}`);
        return response.json();
    }
}

// Store Service
class StoreService {
    private static store: Awaited<ReturnType<typeof load>>;

    static async initialize(): Promise<void> {
        this.store = await load('pastai.json', { autoSave: false });
    }

    static async get<T>(key: string): Promise<T> {
        return this.store.get(key) as Promise<T>;
    }

    static async set(key: string, value: any): Promise<void> {
        await this.store.set(key, value);
    }

    static async save(): Promise<void> {
        await this.store.save();
    }
}

// UI Manager
class UIManager {
    private elements: UIElements;

    constructor(elements: UIElements) {
        this.elements = elements;
    }

    async updateModelList(models: string[]): Promise<void> {
        const { modelSelect } = this.elements;
        modelSelect.innerHTML = models.length === 0
            ? '<option value="">No models found</option>'
            : models.map(model => `<option value="${model}">${model}</option>`).join('');

        const savedModel = await StoreService.get<string>('ollama_model');
        if (savedModel && models.includes(savedModel)) {
            modelSelect.value = savedModel;
        }
    }

    async updateVisibility(llmType: LLMType): Promise<void> {
        const { ollamaSettings, ollamaModelSettings, apiKeyGroup, pasteAISettings } = this.elements;

        // Hide all settings first
        [ollamaSettings, ollamaModelSettings, apiKeyGroup, pasteAISettings].forEach(
            el => el.style.display = 'none'
        );

        // Show relevant sections
        switch (llmType) {
            case 'ollama':
                ollamaSettings.style.display = 'block';
                ollamaModelSettings.style.display = 'block';
                break;
            case 'pasteai':
                pasteAISettings.style.display = 'block';
                break;
            case 'openai':
                apiKeyGroup.style.display = 'block';
                break;
        }
    }

    updateLoginMessage(message: string, isError: boolean = false): void {
        const { loginMessage } = this.elements;
        loginMessage.style.display = 'block';
        loginMessage.style.color = isError ? '#ff0000' : '#008000';
        loginMessage.textContent = isError ? `⚠️ ${message}` : message;
    }
}

// Settings Manager
class SettingsManager {
    private ui: UIManager;
    private elements: UIElements;

    constructor(elements: UIElements) {
        this.elements = elements;
        this.ui = new UIManager(elements);
        this.initializeEventListeners();
    }

    private async initializeEventListeners(): Promise<void> {
        const { llmTypeSelect, ollamaUrl, installPhiButton, loginButton, saveButton, checkQuotaButton } = this.elements;

        llmTypeSelect.addEventListener('change', () => this.handleLLMTypeChange());
        ollamaUrl.addEventListener('change', () => this.handleLLMTypeChange());
        installPhiButton.addEventListener('click', () => this.handlePhiInstall());
        loginButton.addEventListener('click', () => this.handleLogin());
        saveButton.addEventListener('click', () => this.handleSave());
        checkQuotaButton.addEventListener('click', () => this.handleCheckQuota());
    }

    private async handleLLMTypeChange(): Promise<void> {
        const { llmTypeSelect, ollamaUrl, ollamaStatus } = this.elements;

        await this.ui.updateVisibility(llmTypeSelect.value as LLMType);

        if (llmTypeSelect.value === 'ollama') {
            const isAvailable = await APIService.checkOllamaAvailability(ollamaUrl.value);
            ollamaStatus.style.display = isAvailable ? 'none' : 'block';

            if (isAvailable) {
                const models = await APIService.fetchOllamaModels(ollamaUrl.value);
                await this.ui.updateModelList(models);
            }
        }
    }

    private async handlePhiInstall(): Promise<void> {
        const { installPhiButton } = this.elements;
        const outputPre = document.getElementById('installOutput') as HTMLPreElement;

        installPhiButton.disabled = true;
        outputPre.style.display = 'block';
        outputPre.textContent = 'Installing phi:mini...\n';

        try {
            const command = Command.create('ollama', ['pull', 'phi3:mini']);
            this.setupCommandListeners(command, outputPre, installPhiButton);
            await command.spawn();
        } catch (error) {
            outputPre.textContent += `\nError: ${error}`;
            installPhiButton.disabled = false;
        }
    }

    private setupCommandListeners(command: any, outputPre: HTMLPreElement, button: HTMLButtonElement): void {
        command.on('close', async ({ code }: { code: number }) => {
            outputPre.textContent += code === 0 ? '\nInstallation complete!' : `\nProcess exited with code ${code}`;
            button.disabled = false;
            if (code === 0) await this.handleLLMTypeChange();
        });

        command.on('error', (error: Error) => {
            outputPre.textContent += `\nError: ${error}`;
            button.disabled = false;
        });

        ['stdout', 'stderr'].forEach(stream => {
            command[stream].on('data', (line: string) => {
                outputPre.textContent += line + '\n';
                outputPre.scrollTop = outputPre.scrollHeight;
            });
        });
    }

    private async handleLogin(): Promise<void> {
        const { emailInput, loginButton, llmTypeSelect } = this.elements;
        const email = emailInput.value.trim();

        if (!email) {
            this.ui.updateLoginMessage('Please enter an email address', true);
            return;
        }

        loginButton.disabled = true;
        this.ui.updateLoginMessage('Sending verification email...', false);

        try {
            const appId = await StoreService.get<string>('appId');
            await StoreService.set('email', email);
            await StoreService.set('llm_type', llmTypeSelect.value);
            await StoreService.save();

            const response = await APIService.loginUser(email, appId);
            this.ui.updateLoginMessage(
                response.status === 'ok'
                    ? response.data.message
                    : response.data.message || 'An error occurred',
                response.status !== 'ok'
            );
        } catch (error) {
            this.ui.updateLoginMessage('Failed to send verification email', true);
            console.error('Login error:', error);
        } finally {
            loginButton.disabled = false;
        }
    }

    private async handleSave(): Promise<void> {
        const { saveButton, llmTypeSelect, ollamaUrl, modelSelect, apiKeyInput, systemPromptInput } = this.elements;

        try {
            saveButton.disabled = true;

            await StoreService.set('llm_type', llmTypeSelect.value);
            await StoreService.set('ollama_url', ollamaUrl.value);
            await StoreService.set('ollama_model', modelSelect.value);

            if (llmTypeSelect.value === 'openai') {
                const apiKey = apiKeyInput.value.trim();
                if (!apiKey) {
                    console.warn('Empty API key submitted');
                    return;
                }
                await StoreService.set('openai_api_key', apiKey);
            }

            const systemPrompt = systemPromptInput.value.trim();
            await StoreService.save();
            await emit('settings-saved', { saved: true });
            await invoke('set_system_prompt_from_settings', { prompt: systemPrompt });
            await (await Window.getByLabel('settings'))?.close();
        } catch (error) {
            console.error('Error saving settings:', error);
            if (error instanceof Error) {
                console.error('Error details:', error.message);
            }
        }
    }

    private async handleCheckQuota(): Promise<void> {
        const { quotaDisplay } = this.elements;
        try {
            const appId = await StoreService.get<string>('appId');
            const response = await APIService.checkQuota(appId);
            if (response.status === 'ok') {
                quotaDisplay.textContent = `Available credits: ${response.data.balance}`;
                quotaDisplay.style.color = '#008000';
            } else {
                quotaDisplay.textContent = 'Error, maybe login first';
                quotaDisplay.style.color = '#ff0000';
            }
        } catch (error) {
            quotaDisplay.textContent = 'Error, maybe login first';
            quotaDisplay.style.color = '#ff0000';
        }
    }

    async loadExistingSettings(): Promise<void> {
        const { llmTypeSelect, emailInput, ollamaUrl, apiKeyInput, systemPromptInput } = this.elements;

        try {
            await StoreService.initialize();

            const savedLlmType = await StoreService.get<string>('llm_type') || 'pasteai';
            llmTypeSelect.value = savedLlmType;

            const savedEmail = await StoreService.get<string>('email');
            if (savedEmail) emailInput.value = savedEmail;

            const savedOllamaUrl = await StoreService.get<string>('ollama_url');
            if (savedOllamaUrl) ollamaUrl.value = savedOllamaUrl;

            const openaiApiKey = await StoreService.get<string>('openai_api_key');
            if (openaiApiKey) apiKeyInput.value = openaiApiKey;

            const systemPrompt = await invoke('get_system_prompt_from_settings');
            if (systemPrompt) systemPromptInput.value = systemPrompt as string;

            await this.handleLLMTypeChange();
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }
}

// Initialize application
async function initializeUI(): Promise<void> {
    const elements = {
        apiKeyInput: document.getElementById('apiKey') as HTMLInputElement,
        systemPromptInput: document.getElementById('systemPrompt') as HTMLTextAreaElement,
        saveButton: document.getElementById('saveButton') as HTMLButtonElement,
        ollamaUrl: document.getElementById('ollamaUrl') as HTMLInputElement,
        modelSelect: document.getElementById('ollamaModel') as HTMLSelectElement,
        installPhiButton: document.getElementById('installPhi') as HTMLButtonElement,
        llmTypeSelect: document.getElementById('llmType') as HTMLSelectElement,
        loginButton: document.getElementById('loginButton') as HTMLButtonElement,
        loginMessage: document.getElementById('loginMessage') as HTMLDivElement,
        emailInput: document.getElementById('pasteAIEmail') as HTMLInputElement,
        ollamaSettings: document.getElementById('ollamaSettings') as HTMLDivElement,
        ollamaModelSettings: document.getElementById('ollamaModelSettings') as HTMLDivElement,
        ollamaStatus: document.getElementById('ollamaStatus') as HTMLDivElement,
        apiKeyGroup: document.querySelector('.input-group:has(#apiKey)') as HTMLDivElement,
        pasteAISettings: document.getElementById('pasteAISettings') as HTMLDivElement,
        checkQuotaButton: document.getElementById('checkQuotaButton') as HTMLButtonElement,
        quotaDisplay: document.getElementById('quotaDisplay') as HTMLDivElement,
    };

    if (Object.values(elements).some(element => !element)) {
        console.error('Required elements not found');
        return;
    }

    const settingsManager = new SettingsManager(elements);
    await settingsManager.loadExistingSettings();
}

window.addEventListener("DOMContentLoaded", async () => {
    await initializeUI();
});
