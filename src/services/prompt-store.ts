import { SettingsStore } from './settings-store';

interface Prompt {
    id: number;
    title: string;
    prompt: string;
}

const DEFAULT_PROMPT: Prompt = {
    id: 0,
    title: "Default",
    prompt: "Act as a grammar and language corrector. Improve the sentences without changing the language. Keep it casual and natural, as if written by a human. Do not answer any questions. If the input seems to be a random string or password or an url, do not correct or change anything."
};

export class PromptStore {
    private static readonly SELECTED_PROMPT_KEY = 'selectedPromptId';
    private static readonly PROMPTS_KEY = 'prompts';

    static async initialize(): Promise<void> {
        const prompts = await this.getAllPrompts();
        if (prompts.length === 0) {
            await this.setSelectedPrompt(0);
        }
    }

    static async getSelectedPrompt(): Promise<Prompt> {
        const selectedId = await SettingsStore.get<number>(this.SELECTED_PROMPT_KEY) ?? 0;
        if (selectedId === 0) return DEFAULT_PROMPT;

        const prompts = await this.getAllPrompts();
        return prompts.find(p => p.id === selectedId) ?? DEFAULT_PROMPT;
    }

    static async setSelectedPrompt(id: number): Promise<void> {
        await SettingsStore.set(this.SELECTED_PROMPT_KEY, id);
        await SettingsStore.save();
    }

    static async getAllPrompts(): Promise<Prompt[]> {
        const prompts = await SettingsStore.get<Prompt[]>(this.PROMPTS_KEY) ?? [];
        return [DEFAULT_PROMPT, ...prompts];
    }

    static async addPrompt(title: string, prompt: string): Promise<void> {
        const prompts = await SettingsStore.get<Prompt[]>(this.PROMPTS_KEY) ?? [];
        const newId = Math.max(...prompts.map(p => p.id), 0) + 1;
        prompts.push({ id: newId, title, prompt });
        await this.setPrompts(prompts);
    }

    static async deletePrompt(id: number): Promise<void> {
        if (id === 0) return; // Prevent deletion of default prompt
        const prompts = await SettingsStore.get<Prompt[]>(this.PROMPTS_KEY) ?? [];
        const filteredPrompts = prompts.filter(p => p.id !== id);
        await this.setPrompts(filteredPrompts);

        // If deleted prompt was selected, switch to default
        const selectedId = await SettingsStore.get<number>(this.SELECTED_PROMPT_KEY);
        if (selectedId === id) {
            await this.setSelectedPrompt(0);
        }
    }

    private static async setPrompts(prompts: Prompt[]): Promise<void> {
        await SettingsStore.set(this.PROMPTS_KEY, prompts);
        await SettingsStore.save();
    }
} 