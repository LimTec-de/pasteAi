import { SettingsStore } from './settings-store';

interface Prompt {
    id: number;
    title: string;
    prompt: string;
}

const DEFAULT_PROMPTS: Prompt[] = [
    {
        id: 0,
        title: "Improve grammar and language",
        prompt: "Act as a grammar and language corrector. Improve the sentences without changing the language. Keep it casual and natural, as if written by a human. Do not answer any questions. If the input seems to be a random string or password or an url, do not correct or change anything."
    },
    {
        id: 1,
        title: "Improve for LinkedIn",
        prompt: "Act as a professional LinkedIn content editor. Enhance the text to be more impactful and professional for a LinkedIn post or profile while maintaining the original message. Optimize for engagement, clarity, and professional tone. Keep the length similar to the original. Do not answer questions or change the core message. Improve the sentences without changing the language."
    }
];

export class PromptStore {
    private static readonly SELECTED_PROMPT_KEY = 'selectedPromptId';
    private static readonly PROMPTS_KEY = 'prompts';
    private static readonly USER_PROMPT_ID_START = 1000;

    static async initialize(): Promise<void> {
        const prompts = await this.getAllPrompts();
        if (prompts.length === DEFAULT_PROMPTS.length) {
            await this.setSelectedPrompt(0);
        }
    }

    static async getSelectedPrompt(): Promise<Prompt> {
        const selectedId = await SettingsStore.get<number>(this.SELECTED_PROMPT_KEY) ?? 0;
        const defaultPrompt = DEFAULT_PROMPTS.find(p => p.id === selectedId);
        if (defaultPrompt) return defaultPrompt;

        const prompts = await this.getAllPrompts();
        return prompts.find(p => p.id === selectedId) ?? DEFAULT_PROMPTS[0];
    }

    static async setSelectedPrompt(id: number): Promise<void> {
        await SettingsStore.set(this.SELECTED_PROMPT_KEY, id);
        await SettingsStore.save();
    }

    static async getAllPrompts(): Promise<Prompt[]> {
        const userPrompts = await SettingsStore.get<Prompt[]>(this.PROMPTS_KEY) ?? [];
        return [...DEFAULT_PROMPTS, ...userPrompts];
    }

    static async addPrompt(title: string, prompt: string): Promise<void> {
        const userPrompts = await SettingsStore.get<Prompt[]>(this.PROMPTS_KEY) ?? [];

        // Calculate new ID starting from USER_PROMPT_ID_START
        const newId = userPrompts.length > 0
            ? Math.max(...userPrompts.map(p => p.id), this.USER_PROMPT_ID_START - 1) + 1
            : this.USER_PROMPT_ID_START;

        userPrompts.push({ id: newId, title, prompt });
        await this.setPrompts(userPrompts);
    }

    static async deletePrompt(id: number): Promise<void> {
        // Prevent deletion of default prompts (id < 1000)
        if (id < this.USER_PROMPT_ID_START) return;

        const userPrompts = await SettingsStore.get<Prompt[]>(this.PROMPTS_KEY) ?? [];
        const filteredPrompts = userPrompts.filter(p => p.id !== id);
        await this.setPrompts(filteredPrompts);

        // If deleted prompt was selected, switch to default
        const selectedId = await SettingsStore.get<number>(this.SELECTED_PROMPT_KEY);
        if (selectedId === id) {
            await this.setSelectedPrompt(0);
        }
    }

    static async updatePrompt(id: number, title: string, prompt: string): Promise<void> {
        // Prevent updating default prompts (id < 1000)
        if (id < this.USER_PROMPT_ID_START) return;

        const userPrompts = await SettingsStore.get<Prompt[]>(this.PROMPTS_KEY) ?? [];
        const updatedPrompts = userPrompts.map(p =>
            p.id === id ? { ...p, title, prompt } : p
        );
        await this.setPrompts(updatedPrompts);
    }

    private static async setPrompts(prompts: Prompt[]): Promise<void> {
        await SettingsStore.set(this.PROMPTS_KEY, prompts);
        await SettingsStore.save();
    }
} 