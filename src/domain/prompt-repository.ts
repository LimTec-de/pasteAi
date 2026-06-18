import type { PromptOption, PromptOutputMode } from './types';
import { SettingsRepository } from './settings-repository';

export const DEFAULT_PROMPTS: PromptOption[] = [
    {
        id: 0,
        identifier: 'grammar',
        outputMode: 'clipboard',
        title: 'Improve grammar and language',
        prompt: 'Act as a grammar and language corrector. Improve the sentences without changing the language. Keep it casual and natural, as if written by a human. Do not answer any questions. If the input seems to be a random string or password or an url, do not correct or change anything.'
    },
    {
        id: 1,
        identifier: 'linkedin',
        outputMode: 'clipboard',
        title: 'Improve for LinkedIn',
        prompt: 'Act as a professional LinkedIn content editor. Enhance the text to be more impactful and professional for a LinkedIn post or profile while maintaining the original message. Optimize for engagement, clarity, and professional tone. Keep the length similar to the original. Do not answer questions or change the core message. Improve the sentences without changing the language.'
    },
    {
        id: 2,
        identifier: 'twitter',
        outputMode: 'clipboard',
        title: 'Optimize for Twitter/X',
        prompt: 'Act as a Twitter/X content optimizer. Make this text more engaging and concise for Twitter while preserving the core message. Aim for a conversational, punchy style that might generate engagement. Keep it under 280 characters if possible. Add relevant hashtags if appropriate. Do not answer questions or change the main point of the message. Improve the sentences without changing the language.'
    },
    {
        id: 3,
        identifier: 'simplify',
        outputMode: 'clipboard',
        title: 'Simplify and clarify',
        prompt: 'Act as a simplification expert. Rewrite the text to make it clearer, more concise, and easier to understand. Remove jargon, break down complex ideas, and use simpler language without losing the original meaning. Aim for a reading level accessible to a broad audience. Do not answer questions or add new information not present in the original text. Improve the sentences without changing the language.'
    },
    {
        id: 4,
        identifier: 'email',
        outputMode: 'clipboard',
        title: 'Email professional tone',
        prompt: 'Act as an email communication expert. Rewrite this text to be appropriate for a professional email. Ensure it has a clear structure with proper greeting and sign-off if needed. Make it polite, concise, and professional while maintaining the original message and intent. Improve clarity and formality without making it overly stiff or formal. Do not answer questions or add new information. Improve the sentences without changing the language.'
    }
];

const PROMPTS_KEY = 'prompts';
const BUILTIN_OUTPUT_MODES_KEY = 'builtinOutputModes';
const USER_PROMPT_ID_START = 1000;

interface StoredPrompt {
    id: number;
    title: string;
    prompt: string;
    identifier?: unknown;
    outputMode?: unknown;
}

export class PromptRepository {
    constructor(private readonly settingsRepository: SettingsRepository) {}

    async initialize(): Promise<void> {
        const storedPrompts = await this.settingsRepository.getRawValue<StoredPrompt[]>(PROMPTS_KEY);
        if (!Array.isArray(storedPrompts)) {
            await this.settingsRepository.setRawValue(PROMPTS_KEY, []);
            await this.settingsRepository.saveRawChanges();
            return;
        }

        await this.backfillPrompts(storedPrompts);
    }

    async getAllPrompts(): Promise<PromptOption[]> {
        const builtinModes = await this.getBuiltinOutputModes();
        const builtins = DEFAULT_PROMPTS.map((prompt) => ({
            ...prompt,
            outputMode: builtinModes[prompt.id] ?? prompt.outputMode
        }));
        const userPrompts = await this.getUserPrompts();
        return [...builtins, ...userPrompts];
    }

    async getPromptByIdentifier(identifier: string): Promise<PromptOption | null> {
        const normalized = identifier.trim().toLowerCase();
        if (!normalized) {
            return null;
        }

        const prompts = await this.getAllPrompts();
        return prompts.find((entry) => entry.identifier.toLowerCase() === normalized) ?? null;
    }

    async addPrompt(title: string, prompt: string, identifier: string, outputMode: PromptOutputMode): Promise<void> {
        const userPrompts = await this.getUserPrompts();
        const newId = userPrompts.length > 0
            ? Math.max(...userPrompts.map((entry) => entry.id), USER_PROMPT_ID_START - 1) + 1
            : USER_PROMPT_ID_START;

        const finalIdentifier = await this.resolveIdentifier(identifier, title, newId);

        userPrompts.push({ id: newId, title, prompt, identifier: finalIdentifier, outputMode });
        await this.setPrompts(userPrompts);
    }

    async updatePrompt(id: number, title: string, prompt: string, identifier: string, outputMode: PromptOutputMode): Promise<void> {
        if (id < USER_PROMPT_ID_START) {
            return;
        }

        const finalIdentifier = await this.resolveIdentifier(identifier, title, id);

        const prompts = await this.getUserPrompts();
        await this.setPrompts(prompts.map((entry) => (
            entry.id === id ? { ...entry, title, prompt, identifier: finalIdentifier, outputMode } : entry
        )));
    }

    async setOutputMode(id: number, outputMode: PromptOutputMode): Promise<void> {
        if (id < USER_PROMPT_ID_START) {
            const builtinModes = await this.getBuiltinOutputModes();
            const builtin = DEFAULT_PROMPTS.find((entry) => entry.id === id);
            if (!builtin) {
                return;
            }

            if (outputMode === builtin.outputMode) {
                delete builtinModes[id];
            } else {
                builtinModes[id] = outputMode;
            }

            await this.settingsRepository.setRawValue(BUILTIN_OUTPUT_MODES_KEY, builtinModes);
            await this.settingsRepository.saveRawChanges();
            return;
        }

        const prompts = await this.getUserPrompts();
        await this.setPrompts(prompts.map((entry) => (
            entry.id === id ? { ...entry, outputMode } : entry
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
        const rawPrompts = await this.settingsRepository.getRawValue<StoredPrompt[]>(PROMPTS_KEY);
        if (!Array.isArray(rawPrompts)) {
            return [];
        }

        return rawPrompts
            .filter((entry) => this.isValidStoredPrompt(entry))
            .map((entry) => this.normalizeStoredPrompt(entry));
    }

    private async getBuiltinOutputModes(): Promise<Record<number, PromptOutputMode>> {
        const stored = await this.settingsRepository.getRawValue<Record<string, unknown>>(BUILTIN_OUTPUT_MODES_KEY);
        if (typeof stored !== 'object' || stored === null) {
            return {};
        }

        const result: Record<number, PromptOutputMode> = {};
        for (const [key, value] of Object.entries(stored)) {
            const id = Number.parseInt(key, 10);
            if (Number.isFinite(id) && (value === 'clipboard' || value === 'window')) {
                result[id] = value;
            }
        }

        return result;
    }

    private async backfillPrompts(storedPrompts: StoredPrompt[]): Promise<void> {
        const needsBackfill = storedPrompts.some((entry) => (
            this.isValidStoredPrompt(entry)
            && (typeof entry.identifier !== 'string' || (entry.outputMode !== 'clipboard' && entry.outputMode !== 'window'))
        ));

        if (!needsBackfill) {
            return;
        }

        const taken = new Set(DEFAULT_PROMPTS.map((entry) => entry.identifier));
        for (const entry of storedPrompts) {
            if (this.isValidStoredPrompt(entry) && typeof entry.identifier === 'string' && entry.identifier.trim()) {
                taken.add(entry.identifier.toLowerCase());
            }
        }

        const migrated = storedPrompts
            .filter((entry) => this.isValidStoredPrompt(entry))
            .map((entry) => {
                const hasIdentifier = typeof entry.identifier === 'string' && entry.identifier.trim().length > 0;
                const identifier = hasIdentifier
                    ? (entry.identifier as string)
                    : this.uniqueSlug(this.slugify(entry.title) || `prompt-${entry.id}`, taken);
                if (!hasIdentifier) {
                    taken.add(identifier.toLowerCase());
                }

                const outputMode: PromptOutputMode = entry.outputMode === 'window' ? 'window' : 'clipboard';
                return { id: entry.id, title: entry.title, prompt: entry.prompt, identifier, outputMode };
            });

        await this.setPrompts(migrated);
    }

    private async resolveIdentifier(identifier: string, title: string, ownId: number): Promise<string> {
        const slug = this.slugify(identifier) || this.slugify(title) || `prompt-${ownId}`;
        const taken = new Set<string>();

        for (const entry of DEFAULT_PROMPTS) {
            taken.add(entry.identifier.toLowerCase());
        }

        const userPrompts = await this.getUserPrompts();
        for (const entry of userPrompts) {
            if (entry.id !== ownId) {
                taken.add(entry.identifier.toLowerCase());
            }
        }

        if (taken.has(slug)) {
            throw new Error(`The identifier "${slug}" is already in use.`);
        }

        return slug;
    }

    private slugify(value: string): string {
        return value
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    private uniqueSlug(base: string, taken: Set<string>): string {
        let candidate = base;
        let suffix = 2;
        while (taken.has(candidate.toLowerCase())) {
            candidate = `${base}-${suffix}`;
            suffix += 1;
        }

        return candidate;
    }

    private async setPrompts(prompts: PromptOption[]): Promise<void> {
        await this.settingsRepository.setRawValue(PROMPTS_KEY, prompts);
        await this.settingsRepository.saveRawChanges();
    }

    private normalizeStoredPrompt(entry: StoredPrompt): PromptOption {
        const identifier = typeof entry.identifier === 'string' && entry.identifier.trim()
            ? entry.identifier
            : (this.slugify(entry.title) || `prompt-${entry.id}`);
        const outputMode: PromptOutputMode = entry.outputMode === 'window' ? 'window' : 'clipboard';
        return { id: entry.id, title: entry.title, prompt: entry.prompt, identifier, outputMode };
    }

    private isValidStoredPrompt(prompt: unknown): prompt is StoredPrompt {
        if (typeof prompt !== 'object' || prompt === null) {
            return false;
        }

        const candidate = prompt as Record<string, unknown>;
        return typeof candidate.id === 'number'
            && typeof candidate.title === 'string'
            && typeof candidate.prompt === 'string';
    }
}
