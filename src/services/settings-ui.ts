import { SettingsStore } from './settings-store';

export type LLMType = 'pasteai' | 'ollama' | 'openai';

export interface SettingsUIElements {
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
    quotaDisplay: HTMLDivElement;
}

export function getUIElements(): SettingsUIElements {
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
        quotaDisplay: document.getElementById('quotaDisplay') as HTMLDivElement
    };

    // Check if all elements were found
    const missingElements = Object.entries(elements)
        .filter(([_, element]) => !element)
        .map(([id]) => id);

    if (missingElements.length > 0) {
        console.error('Missing elements:', missingElements);
        throw new Error(`Could not find elements: ${missingElements.join(', ')}`);
    }

    return elements;
}

export class SettingsUIManager {
    private elements: SettingsUIElements;

    constructor(elements: SettingsUIElements) {
        this.elements = elements;
    }

    async updateModelList(models: string[]): Promise<void> {
        const { modelSelect } = this.elements;
        modelSelect.innerHTML = models.length === 0
            ? '<option value="">No models found</option>'
            : models.map(model => `<option value="${model}">${model}</option>`).join('');

        const savedModel = await SettingsStore.get<string>('ollama_model');
        if (savedModel && models.includes(savedModel)) {
            modelSelect.value = savedModel;
        }
    }

    async updateVisibility(llmType: LLMType): Promise<void> {
        const { ollamaSettings, ollamaModelSettings, apiKeyGroup, pasteAISettings } = this.elements;

        // Hide all settings first
        ollamaSettings.style.display = 'none';
        ollamaModelSettings.style.display = 'none';
        apiKeyGroup.style.display = 'none';
        pasteAISettings.style.display = 'none';

        // Show relevant sections based on LLM type
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