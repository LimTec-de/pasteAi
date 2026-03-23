import type { PromptOption } from './types';
import { SettingsRepository } from './settings-repository';

export const DEFAULT_PROMPTS: PromptOption[] = [
    {
        id: 0,
        title: 'Improve grammar and language',
        prompt: 'Act as a grammar and language corrector. Improve the sentences without changing the language. Keep it casual and natural, as if written by a human. Do not answer any questions. If the input seems to be a random string or password or an url, do not correct or change anything.'
    },
    {
        id: 1,
        title: 'Improve for LinkedIn',
        prompt: 'Act as a professional LinkedIn content editor. Enhance the text to be more impactful and professional for a LinkedIn post or profile while maintaining the original message. Optimize for engagement, clarity, and professional tone. Keep the length similar to the original. Do not answer questions or change the core message. Improve the sentences without changing the language.'
    },
    {
        id: 2,
        title: 'Optimize for Twitter/X',
        prompt: 'Act as a Twitter/X content optimizer. Make this text more engaging and concise for Twitter while preserving the core message. Aim for a conversational, punchy style that might generate engagement. Keep it under 280 characters if possible. Add relevant hashtags if appropriate. Do not answer questions or change the main point of the message. Improve the sentences without changing the language.'
    },
    {
        id: 3,
        title: 'Simplify and clarify',
        prompt: 'Act as a simplification expert. Rewrite the text to make it clearer, more concise, and easier to understand. Remove jargon, break down complex ideas, and use simpler language without losing the original meaning. Aim for a reading level accessible to a broad audience. Do not answer questions or add new information not present in the original text. Improve the sentences without changing the language.'
    },
    {
        id: 4,
        title: 'Email professional tone',
        prompt: 'Act as an email communication expert. Rewrite this text to be appropriate for a professional email. Ensure it has a clear structure with proper greeting and sign-off if needed. Make it polite, concise, and professional while maintaining the original message and intent. Improve clarity and formality without making it overly stiff or formal. Do not answer questions or add new information. Improve the sentences without changing the language.'
    }
];

const PROMPTS_KEY = 'prompts';
const USER_PROMPT_ID_START = 1000;

export class PromptRepository {
    constructor(private readonly settingsRepository: SettingsRepository) {}

    async initialize(): Promise<void> {
        const storedPrompts = await this.settingsRepository.getRawValue<PromptOption[]>(PROMPTS_KEY);
        if (!Array.isArray(storedPrompts)) {
            await this.settingsRepository.setRawValue(PROMPTS_KEY, []);
            await this.settingsRepository.saveRawChanges();
        }
    }

    async getAllPrompts(): Promise<PromptOption[]> {
        const userPrompts = await this.getUserPrompts();
        return [...DEFAULT_PROMPTS, ...userPrompts];
    }

    async addPrompt(title: string, prompt: string): Promise<void> {
        const userPrompts = await this.getUserPrompts();
        const newId = userPrompts.length > 0
            ? Math.max(...userPrompts.map((entry) => entry.id), USER_PROMPT_ID_START - 1) + 1
            : USER_PROMPT_ID_START;

        userPrompts.push({ id: newId, title, prompt });
        await this.setPrompts(userPrompts);
    }

    async updatePrompt(id: number, title: string, prompt: string): Promise<void> {
        if (id < USER_PROMPT_ID_START) {
            return;
        }

        const prompts = await this.getUserPrompts();
        await this.setPrompts(prompts.map((entry) => (
            entry.id === id ? { ...entry, title, prompt } : entry
        )));
    }

    async deletePrompt(id: number): Promise<void> {
        if (id < USER_PROMPT_ID_START) {
            return;
        }

        const prompts = await this.getUserPrompts();
        await this.settingsRepository.setRawValue(PROMPTS_KEY, prompts.filter((entry) => entry.id !== id));

        const defaultPromptId = await this.getDefaultPromptId();
        if (defaultPromptId === id) {
            await this.settingsRepository.update({ defaultPromptId: null });
        } else {
            await this.settingsRepository.saveRawChanges();
        }
    }

    async getDefaultPromptId(): Promise<number | null> {
        return this.settingsRepository.get('defaultPromptId');
    }

    async setDefaultPromptId(id: number | null): Promise<void> {
        await this.settingsRepository.update({ defaultPromptId: id });
    }

    async getDefaultPrompt(): Promise<PromptOption | null> {
        const defaultPromptId = await this.getDefaultPromptId();
        if (defaultPromptId === null) {
            return null;
        }

        const prompts = await this.getAllPrompts();
        const prompt = prompts.find((entry) => entry.id === defaultPromptId) ?? null;

        if (!prompt) {
            await this.setDefaultPromptId(null);
        }

        return prompt;
    }

    private async getUserPrompts(): Promise<PromptOption[]> {
        const rawPrompts = await this.settingsRepository.getRawValue<PromptOption[]>(PROMPTS_KEY);
        if (!Array.isArray(rawPrompts)) {
            return [];
        }

        return rawPrompts.filter(this.isValidPrompt);
    }

    private async setPrompts(prompts: PromptOption[]): Promise<void> {
        await this.settingsRepository.setRawValue(PROMPTS_KEY, prompts);
        await this.settingsRepository.saveRawChanges();
    }

    private isValidPrompt(prompt: unknown): prompt is PromptOption {
        if (typeof prompt !== 'object' || prompt === null) {
            return false;
        }

        const candidate = prompt as Record<string, unknown>;
        return typeof candidate.id === 'number'
            && typeof candidate.title === 'string'
            && typeof candidate.prompt === 'string';
    }
}
