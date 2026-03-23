import { load } from '@tauri-apps/plugin-store';

const STORE_PATH = 'pastai.json';

export class AppStore {
    private store: Awaited<ReturnType<typeof load>> | null = null;
    private initializationPromise: Promise<void> | null = null;

    async initialize(): Promise<void> {
        if (!this.initializationPromise) {
            this.initializationPromise = this.loadStore();
        }

        await this.initializationPromise;
    }

    async reload(): Promise<void> {
        await this.initialize();
        await this.store!.reload();
    }

    async get<T>(key: string): Promise<T | undefined> {
        await this.initialize();
        return this.store!.get<T>(key);
    }

    async set(key: string, value: unknown): Promise<void> {
        await this.initialize();
        await this.store!.set(key, value);
    }

    async has(key: string): Promise<boolean> {
        await this.initialize();
        return this.store!.has(key);
    }

    async delete(key: string): Promise<void> {
        await this.initialize();
        await this.store!.delete(key);
    }

    async save(): Promise<void> {
        await this.initialize();
        await this.store!.save();
    }

    private async loadStore(): Promise<void> {
        this.store = await load(STORE_PATH, { autoSave: false, defaults: {} });
    }
}
