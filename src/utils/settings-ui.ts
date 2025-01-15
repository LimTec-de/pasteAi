import { UIElements } from '../types/settings';

export function getUIElements(): UIElements {
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