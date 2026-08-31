import { AppStore } from './store';
import { CONFIG } from '../config';
import { normalizeReplacements, normalizeVocabulary } from './dictate-dictionary';
import {
    DEFAULT_DICTATE_LANGUAGES,
    DEFAULT_DICTATE_PROMPT_ID,
    normalizeLanguageList,
    uniqueLanguageCodes,
    type AppSettings
} from './types';

export const DEFAULT_SETTINGS: AppSettings = {
    llmType: 'pasteai',
    openaiApiKey: '',
    defaultPromptId: null,
    appId: '',
    email: '',
    showStart: true,
    improveHtml: true,
    dictateShortcut: CONFIG.DEFAULT_DICTATE_SHORTCUT,
    dictationProvider: 'openai',
    dictateLanguages: [...DEFAULT_DICTATE_LANGUAGES],
    dictateDownloadedLanguages: [...DEFAULT_DICTATE_LANGUAGES],
    dictateMicrophoneId: '',
    dictateOutputMode: 'insert',
    dictatePromptId: DEFAULT_DICTATE_PROMPT_ID,
    dictateVocabulary: [],
    dictateReplacements: []
};

const SETTINGS_KEYS: { [K in keyof AppSettings]: string } = {
    llmType: 'llmType',
    openaiApiKey: 'openaiApiKey',
    defaultPromptId: 'defaultPromptId',
    appId: 'appId',
    email: 'email',
    showStart: 'showStart',
    improveHtml: 'improveHtml',
    dictateShortcut: 'dictateShortcut',
    dictationProvider: 'dictationProvider',
    dictateLanguages: 'dictateLanguages',
    dictateDownloadedLanguages: 'dictateDownloadedLanguages',
    dictateMicrophoneId: 'dictateMicrophoneId',
    dictateOutputMode: 'dictateOutputMode',
    dictatePromptId: 'dictatePromptId',
    dictateVocabulary: 'dictateVocabulary',
    dictateReplacements: 'dictateReplacements'
};

const LEGACY_SETTINGS_KEYS: Partial<Record<keyof AppSettings, string>> = {
    llmType: 'llm_type',
    openaiApiKey: 'openai_api_key',
    defaultPromptId: 'defaultPromptId',
    appId: 'appId',
    email: 'email',
    showStart: 'show_start'
};

export class SettingsRepository {
    constructor(private readonly store: AppStore) {}

    async initialize(): Promise<void> {
        await this.store.initialize();
        await this.migrateLegacySettings();
    }

    async reload(): Promise<void> {
        await this.store.reload();
        await this.migrateLegacySettings();
    }

    async get<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
        await this.initialize();
        const rawValue = await this.store.get<unknown>(SETTINGS_KEYS[key]);
        return this.normalizeSetting(key, rawValue) as AppSettings[K];
    }

    async getAll(): Promise<AppSettings> {
        const settings = { ...DEFAULT_SETTINGS };
        const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>;

        for (const key of keys) {
            settings[key] = await this.get(key) as never;
        }

        settings.dictateDownloadedLanguages = uniqueLanguageCodes([
            ...settings.dictateDownloadedLanguages,
            ...settings.dictateLanguages
        ]);

        return settings;
    }

    async update(values: Partial<AppSettings>): Promise<void> {
        await this.initialize();

        for (const [key, value] of Object.entries(values) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>) {
            await this.store.set(SETTINGS_KEYS[key], this.normalizeSetting(key, value));
        }

        await this.store.save();
    }

    async ensureAppId(): Promise<string> {
        const currentAppId = await this.get('appId');
        if (currentAppId) {
            return currentAppId;
        }

        const appId = crypto.randomUUID();
        await this.update({ appId });
        return appId;
    }

    async getRawValue<T>(key: string): Promise<T | undefined> {
        await this.initialize();
        return this.store.get<T>(key);
    }

    async setRawValue(key: string, value: unknown): Promise<void> {
        await this.initialize();
        await this.store.set(key, value);
    }

    async saveRawChanges(): Promise<void> {
        await this.initialize();
        await this.store.save();
    }

    private async migrateLegacySettings(): Promise<void> {
        let hasChanges = await this.migrateLegacyDictateLanguage();
        hasChanges = (await this.migrateOllamaSettings()) || hasChanges;
        const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>;

        for (const key of keys) {
            const currentKey = SETTINGS_KEYS[key];
            const legacyKey = LEGACY_SETTINGS_KEYS[key];
            const currentValue = await this.store.get<unknown>(currentKey);

            if (currentValue === undefined) {
                const legacyValue = legacyKey ? await this.store.get<unknown>(legacyKey) : undefined;
                await this.store.set(currentKey, this.normalizeSetting(key, legacyValue));
                hasChanges = true;
            } else {
                const normalizedCurrent = this.normalizeSetting(key, currentValue);
                if (!this.isEqual(currentValue, normalizedCurrent)) {
                    await this.store.set(currentKey, normalizedCurrent);
                    hasChanges = true;
                }
            }

            if (legacyKey && legacyKey !== currentKey && await this.store.has(legacyKey)) {
                await this.store.delete(legacyKey);
                hasChanges = true;
            }
        }

        if (hasChanges) {
            await this.store.save();
        }
    }

    private normalizeSetting<K extends keyof AppSettings>(key: K, value: unknown): AppSettings[K] {
        switch (key) {
            case 'llmType':
                if (value === 'ollama') {
                    return 'local' as AppSettings[K];
                }
                return (value === 'openai' || value === 'local' || value === 'pasteai' || value === 'apple'
                    ? value
                    : DEFAULT_SETTINGS.llmType) as AppSettings[K];
            case 'dictationProvider':
                return (value === 'openai' || value === 'apple' || value === 'local'
                    ? value
                    : DEFAULT_SETTINGS.dictationProvider) as AppSettings[K];
            case 'dictateLanguages':
                return this.normalizeDictateLanguages(value) as AppSettings[K];
            case 'dictateDownloadedLanguages':
                return this.normalizeDownloadedLanguages(value) as AppSettings[K];
            case 'dictateOutputMode':
                return (value === 'insert' || value === 'clipboard'
                    ? value
                    : DEFAULT_SETTINGS.dictateOutputMode) as AppSettings[K];
            case 'dictateVocabulary':
                return normalizeVocabulary(value) as AppSettings[K];
            case 'dictateReplacements':
                return normalizeReplacements(value) as AppSettings[K];
            case 'dictatePromptId':
                if (typeof value === 'number' && Number.isFinite(value)) {
                    return value as AppSettings[K];
                }

                if (typeof value === 'string') {
                    if (value.trim() === '') {
                        return null as AppSettings[K];
                    }

                    const parsedValue = Number.parseInt(value, 10);
                    return (Number.isFinite(parsedValue)
                        ? parsedValue
                        : DEFAULT_SETTINGS.dictatePromptId) as AppSettings[K];
                }

                return (value === null ? null : DEFAULT_SETTINGS.dictatePromptId) as AppSettings[K];
            case 'openaiApiKey':
            case 'appId':
            case 'email':
            case 'dictateShortcut':
                return (typeof value === 'string' && value.trim().length > 0
                    ? value
                    : DEFAULT_SETTINGS[key]) as AppSettings[K];
            case 'dictateMicrophoneId':
                return (typeof value === 'string' ? value : DEFAULT_SETTINGS.dictateMicrophoneId) as AppSettings[K];
            case 'defaultPromptId':
                if (typeof value === 'number' && Number.isFinite(value)) {
                    return value as AppSettings[K];
                }

                if (typeof value === 'string') {
                    if (value.trim() === '') {
                        return null as AppSettings[K];
                    }

                    const parsedValue = Number.parseInt(value, 10);
                    return (Number.isFinite(parsedValue) ? parsedValue : null) as AppSettings[K];
                }

                return (value === null ? null : DEFAULT_SETTINGS.defaultPromptId) as AppSettings[K];
            case 'showStart':
                return (typeof value === 'boolean' ? value : DEFAULT_SETTINGS.showStart) as AppSettings[K];
            case 'improveHtml':
                return (typeof value === 'boolean' ? value : DEFAULT_SETTINGS.improveHtml) as AppSettings[K];
            default:
                return DEFAULT_SETTINGS[key];
        }
    }

    private async migrateOllamaSettings(): Promise<boolean> {
        const keys = ['ollamaUrl', 'ollamaModel', 'ollama_url', 'ollama_model'];
        let hasChanges = false;
        for (const key of keys) {
            if (await this.store.has(key)) {
                await this.store.delete(key);
                hasChanges = true;
            }
        }

        const llmType = await this.store.get<unknown>(SETTINGS_KEYS.llmType);
        if (llmType === 'ollama') {
            await this.store.set(SETTINGS_KEYS.llmType, 'local');
            hasChanges = true;
        }

        return hasChanges;
    }

    private async migrateLegacyDictateLanguage(): Promise<boolean> {
        const legacy = await this.store.get<unknown>('dictateLanguage');
        if (legacy === undefined) {
            return false;
        }

        if (!(await this.store.has('dictateLanguages'))) {
            const mapped = this.normalizeDictateLanguages(legacy);
            await this.store.set('dictateLanguages', mapped);
            if (!(await this.store.has('dictateDownloadedLanguages'))) {
                await this.store.set('dictateDownloadedLanguages', mapped);
            }
        }

        await this.store.delete('dictateLanguage');
        return true;
    }

    private normalizeDictateLanguages(value: unknown): string[] {
        const codes = normalizeLanguageList(value, DEFAULT_DICTATE_LANGUAGES);
        return codes.length > 0 ? codes : [...DEFAULT_DICTATE_LANGUAGES];
    }

    private normalizeDownloadedLanguages(value: unknown): string[] {
        const codes = normalizeLanguageList(value, DEFAULT_DICTATE_LANGUAGES);
        return codes.length > 0 ? codes : [...DEFAULT_DICTATE_LANGUAGES];
    }

    private isEqual(left: unknown, right: unknown): boolean {
        return JSON.stringify(left) === JSON.stringify(right);
    }
}
