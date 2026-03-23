export type ProviderId = 'pasteai' | 'openai' | 'ollama';

export type ManagedWindowId = 'dashboard' | 'prompt' | 'status';

export type DashboardSection = 'welcome' | 'providers' | 'prompts' | 'about';

export interface AppSettings {
    llmType: ProviderId;
    openaiApiKey: string;
    ollamaUrl: string;
    ollamaModel: string;
    defaultPromptId: number | null;
    appId: string;
    email: string;
    showStart: boolean;
}

export interface PromptOption {
    id: number;
    title: string;
    prompt: string;
}

export type StatusType = 'error' | 'ok' | 'working' | 'info';

export interface StatusDisplayPayload {
    message: string;
    type: StatusType;
    autohide?: boolean;
    allowHtml?: boolean;
}

export interface PasteAIQuota {
    balance: number;
    email: string | null;
}
