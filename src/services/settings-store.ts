import { load } from '@tauri-apps/plugin-store';

export class SettingsStore {
    private static store: Awaited<ReturnType<typeof load>>;

    static async initialize(): Promise<void> {
        this.store = await load('pastai.json', { autoSave: false, defaults: {} });
    }

    static async get<T>(key: string): Promise<T> {
        return this.store.get(key) as Promise<T>;
    }

    static async set(key: string, value: any): Promise<void> {
        await this.store.set(key, value);
    }

    static async save(): Promise<void> {
        await this.store.save();
    }
} 