import { UIElements, LLMType } from '../types/settings';
import { SettingsStore } from './settings-store';

export class SettingsUIManager {
    private elements: UIElements;

    constructor(elements: UIElements) {
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