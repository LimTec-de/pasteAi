export interface UIElements {
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

export type LLMType = 'pasteai' | 'ollama' | 'openai'; 