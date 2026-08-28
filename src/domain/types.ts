export type ProviderId = 'pasteai' | 'openai' | 'ollama' | 'apple';

export type DictationProviderId = 'openai' | 'apple' | 'local';

export type DictateOutputMode = 'insert' | 'clipboard';

export type ManagedWindowId = 'dashboard' | 'prompt' | 'status' | 'answer' | 'dictate';

export type DashboardSection = 'welcome' | 'providers' | 'dictation' | 'prompts' | 'shell' | 'about';

export const DEFAULT_DICTATE_LANGUAGES = ['de', 'en'];

export const DEFAULT_DICTATE_PROMPT_ID = 6;

export const FALLBACK_SPEECH_LANGUAGE_CODES = [
    'ar', 'da', 'de', 'en', 'es', 'fi', 'fr', 'he', 'it', 'ja', 'ko',
    'ms', 'nb', 'nl', 'pt', 'ru', 'sv', 'th', 'tr', 'vi', 'yue', 'zh'
];

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
    dictateLanguages: string[];
    dictateDownloadedLanguages: string[];
    dictateMicrophoneId: string;
    dictateOutputMode: DictateOutputMode;
    dictatePromptId: number | null;
    dictateVocabulary: string[];
    dictateReplacements: DictateReplacement[];
}

export interface DictateReplacement {
    id: string;
    from: string;
    to: string;
}

export interface DictionaryLearnPair {
    from: string;
    to: string;
}

export function isLanguageCode(value: string): boolean {
    return /^[a-z]{2,3}$/.test(value);
}

export function uniqueLanguageCodes(codes: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const code of codes) {
        if (!isLanguageCode(code) || seen.has(code)) {
            continue;
        }
        seen.add(code);
        unique.push(code);
    }
    return unique;
}

export function normalizeLanguageList(value: unknown, fallback: string[] = DEFAULT_DICTATE_LANGUAGES): string[] {
    if (typeof value === 'string') {
        if (value === 'auto') {
            return [...fallback];
        }
        return uniqueLanguageCodes(value.split(/[,\s]+/));
    }

    if (Array.isArray(value)) {
        return uniqueLanguageCodes(value.filter((item): item is string => typeof item === 'string'));
    }

    return [];
}

export interface SpeechLanguage {
    code: string;
    label: string;
}

export interface SpeechLanguageCatalog {
    languages: SpeechLanguage[];
    maxActiveLanguages: number;
}

export function languageDisplayName(code: string): string {
    try {
        return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
    } catch {
        return code;
    }
}

export function fallbackSpeechLanguageCatalog(): SpeechLanguageCatalog {
    return {
        languages: FALLBACK_SPEECH_LANGUAGE_CODES.map((code) => ({
            code,
            label: languageDisplayName(code)
        })),
        maxActiveLanguages: 2
    };
}

export function transcriptionLanguages(settings: Pick<AppSettings, 'dictateLanguages'>): string[] {
    return settings.dictateLanguages.length > 0 ? settings.dictateLanguages : [...DEFAULT_DICTATE_LANGUAGES];
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

export interface StatusAction {
    id: 'add' | 'skip';
    label: string;
}

export interface StatusDisplayPayload {
    message: string;
    type: StatusType;
    autohide?: boolean;
    allowHtml?: boolean;
    pairs?: DictionaryLearnPair[];
    actions?: StatusAction[];
}

export interface PasteAIQuota {
    balance: number;
    email: string | null;
}
