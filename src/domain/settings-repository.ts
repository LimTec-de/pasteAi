import { AppStore } from './store';
import type { AppSettings } from './types';

export const DEFAULT_SETTINGS: AppSettings = {
    llmType: 'pasteai',
    openaiApiKey: '',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: '',
    defaultPromptId: null,
    appId: '',
    email: '',
    showStart: true
};

const SETTINGS_KEYS: { [K in keyof AppSettings]: string } = {
    llmType: 'llmType',
    openaiApiKey: 'openaiApiKey',
    ollamaUrl: 'ollamaUrl',
    ollamaModel: 'ollamaModel',
    defaultPromptId: 'defaultPromptId',
    appId: 'appId',
    email: 'email',
    showStart: 'showStart'
};

const LEGACY_SETTINGS_KEYS: Partial<Record<keyof AppSettings, string>> = {
    llmType: 'llm_type',
    openaiApiKey: 'openai_api_key',
    ollamaUrl: 'ollama_url',
    ollamaModel: 'ollama_model',
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
        const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>;
        let hasChanges = false;

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
                return (value === 'openai' || value === 'ollama' || value === 'pasteai'
                    ? value
                    : DEFAULT_SETTINGS.llmType) as AppSettings[K];
            case 'openaiApiKey':
            case 'ollamaUrl':
            case 'ollamaModel':
            case 'appId':
            case 'email':
                return (typeof value === 'string' ? value : DEFAULT_SETTINGS[key]) as AppSettings[K];
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
            default:
                return DEFAULT_SETTINGS[key];
        }
    }

    private isEqual(left: unknown, right: unknown): boolean {
        return JSON.stringify(left) === JSON.stringify(right);
    }
}
