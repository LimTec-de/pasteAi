import { SettingsStore } from './settings-store';
import { PromptStore } from './prompt-store';
import { Window } from '@tauri-apps/api/window';

export type LLMType = 'pasteai' | 'ollama' | 'openai';

interface PromptEditorState {
    isEditing: boolean;
    editingPromptId: number | null;
}

export interface SettingsUIElements {
    apiKeyInput: HTMLInputElement;
    closeButton: HTMLButtonElement;
    ollamaUrl: HTMLInputElement;
    modelSelect: HTMLSelectElement;
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
    // Prompt management elements
    promptList: HTMLDivElement;
    promptEditor: HTMLDivElement;
    promptTitle: HTMLInputElement;
    promptText: HTMLTextAreaElement;
    addPromptButton: HTMLButtonElement;
    savePromptButton: HTMLButtonElement;
    cancelPromptButton: HTMLButtonElement;
}

export function getUIElements(): SettingsUIElements {
    const elements = {
        apiKeyInput: document.getElementById('apiKey') as HTMLInputElement,
        closeButton: document.getElementById('closeButton') as HTMLButtonElement,
        ollamaUrl: document.getElementById('ollamaUrl') as HTMLInputElement,
        modelSelect: document.getElementById('ollamaModel') as HTMLSelectElement,
        llmTypeSelect: document.getElementById('llmType') as HTMLSelectElement,
        loginButton: document.getElementById('loginButton') as HTMLButtonElement,
        loginMessage: document.getElementById('loginMessage') as HTMLDivElement,
        emailInput: document.getElementById('pasteAIEmail') as HTMLInputElement,
        ollamaSettings: document.getElementById('ollamaSettings') as HTMLDivElement,
        ollamaModelSettings: document.getElementById('ollamaModelSettings') as HTMLDivElement,
        ollamaStatus: document.getElementById('ollamaStatus') as HTMLDivElement,
        apiKeyGroup: document.querySelector('.input-group:has(#apiKey)') as HTMLDivElement,
        pasteAISettings: document.getElementById('pasteAISettings') as HTMLDivElement,
        quotaDisplay: document.getElementById('quotaDisplay') as HTMLDivElement,
        // Prompt management elements
        promptList: document.getElementById('promptList') as HTMLDivElement,
        promptEditor: document.getElementById('promptEditor') as HTMLDivElement,
        promptTitle: document.getElementById('promptTitle') as HTMLInputElement,
        promptText: document.getElementById('promptText') as HTMLTextAreaElement,
        addPromptButton: document.getElementById('addPromptButton') as HTMLButtonElement,
        savePromptButton: document.getElementById('savePromptButton') as HTMLButtonElement,
        cancelPromptButton: document.getElementById('cancelPromptButton') as HTMLButtonElement,
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
    private promptEditorState: PromptEditorState;

    constructor(elements: SettingsUIElements) {
        this.elements = elements;
        this.promptEditorState = {
            isEditing: false,
            editingPromptId: null
        };
        this.initializePromptManagement();
        this.initializeCloseButton();
    }

    private initializeCloseButton(): void {
        this.elements.closeButton.onclick = async () => {
            await Window.getCurrent().close();
        };
    }

    private async initializePromptManagement(): Promise<void> {
        const {
            promptList,
            addPromptButton,
            promptEditor,
            promptTitle,
            promptText,
            savePromptButton,
            cancelPromptButton
        } = this.elements;

        // Event listeners
        addPromptButton.onclick = () => this.showPromptEditor();
        savePromptButton.onclick = () => this.savePrompt();
        cancelPromptButton.onclick = () => this.hidePromptEditor();

        // Initial load
        await this.refreshPromptList();
    }

    private async refreshPromptList(): Promise<void> {
        const { promptList } = this.elements;
        const prompts = await PromptStore.getAllPrompts();
        const selectedPrompt = await PromptStore.getSelectedPrompt();

        promptList.innerHTML = '';

        prompts.forEach(prompt => {
            const promptElement = document.createElement('div');
            promptElement.className = `prompt-item ${prompt.id === selectedPrompt.id ? 'selected' : ''}`;

            const promptInfo = document.createElement('div');
            promptInfo.className = 'prompt-info';
            promptInfo.innerHTML = `
                <div class="prompt-title">${prompt.title}</div>
            `;

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'prompt-actions';

            if (prompt.id !== 0) { // Don't show edit/delete for default prompt
                const editButton = document.createElement('button');
                editButton.textContent = '✏️';
                editButton.title = 'Edit';
                editButton.onclick = () => this.editPrompt(prompt);

                const deleteButton = document.createElement('button');
                deleteButton.textContent = '🗑️';
                deleteButton.title = 'Delete';
                deleteButton.onclick = () => this.deletePrompt(prompt.id);

                actionsDiv.appendChild(editButton);
                actionsDiv.appendChild(deleteButton);
            }

            const selectButton = document.createElement('button');
            selectButton.textContent = prompt.id === selectedPrompt.id ? '✓ Default' : 'Set Default';
            selectButton.onclick = () => this.selectPrompt(prompt.id);
            actionsDiv.appendChild(selectButton);

            promptElement.appendChild(promptInfo);
            promptElement.appendChild(actionsDiv);
            promptList.appendChild(promptElement);
        });
    }

    private async selectPrompt(id: number): Promise<void> {
        await PromptStore.setSelectedPrompt(id);
        await this.refreshPromptList();
    }

    private async deletePrompt(id: number): Promise<void> {
        await PromptStore.deletePrompt(id);
        await this.refreshPromptList();
    }

    private editPrompt(prompt: { id: number; title: string; prompt: string }): void {
        const { promptTitle, promptText, promptEditor } = this.elements;
        this.promptEditorState.isEditing = true;
        this.promptEditorState.editingPromptId = prompt.id;
        promptTitle.value = prompt.title;
        promptText.value = prompt.prompt;
        promptEditor.classList.add('visible');
    }

    private showPromptEditor(): void {
        const { promptTitle, promptText, promptEditor } = this.elements;
        this.promptEditorState.isEditing = false;
        this.promptEditorState.editingPromptId = null;
        promptTitle.value = '';
        promptText.value = '';
        promptEditor.classList.add('visible');
    }

    private hidePromptEditor(): void {
        const { promptTitle, promptText, promptEditor } = this.elements;
        promptEditor.classList.remove('visible');
        this.promptEditorState.isEditing = false;
        this.promptEditorState.editingPromptId = null;
        promptTitle.value = '';
        promptText.value = '';
    }

    private async savePrompt(): Promise<void> {
        const { promptTitle, promptText } = this.elements;
        const title = promptTitle.value.trim();
        const prompt = promptText.value.trim();

        if (!title || !prompt) {
            alert('Please fill in both title and prompt');
            return;
        }

        if (this.promptEditorState.isEditing && this.promptEditorState.editingPromptId !== null) {
            await PromptStore.deletePrompt(this.promptEditorState.editingPromptId);
            await PromptStore.addPrompt(title, prompt);
        } else {
            await PromptStore.addPrompt(title, prompt);
        }

        this.hidePromptEditor();
        await this.refreshPromptList();
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