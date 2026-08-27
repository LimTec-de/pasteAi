export type ProviderId = 'pasteai' | 'openai' | 'ollama' | 'apple';

export type DictationProviderId = 'openai' | 'apple';

export type DictateLanguage = 'auto' | 'de' | 'en';

export type DictateOutputMode = 'insert' | 'clipboard';

export type ManagedWindowId = 'dashboard' | 'prompt' | 'status' | 'answer' | 'dictate';

export type DashboardSection = 'welcome' | 'providers' | 'dictation' | 'prompts' | 'shell' | 'about';

export interface AppSettings {
    llmType: ProviderId;
    openaiApiKey: string;
    ollamaUrl: string;
    ollamaModel: string;
    defaultPromptId: number | null;
    appId: string;
    email: string;
    showStart: boolean;
    improveHtml: boolean;
    dictateShortcut: string;
    dictationProvider: DictationProviderId;
    dictateLanguage: DictateLanguage;
    dictateMicrophoneId: string;
    dictateOutputMode: DictateOutputMode;
}

export function transcriptionLanguages(language: DictateLanguage): string[] {
    return language === 'auto' ? ['de', 'en'] : [language];
}

export type PromptOutputMode = 'clipboard' | 'window';

export interface PromptOption {
    id: number;
    title: string;
    prompt: string;
    identifier: string;
    outputMode: PromptOutputMode;
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
