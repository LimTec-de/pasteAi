import OpenAI from 'openai';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { CONFIG } from '../config';
import { SettingsRepository } from './settings-repository';
import type { AppSettings, PasteAIQuota } from './types';

interface PasteAIErrorResponse {
    status: 'error';
    data: {
        type: 'quota' | 'error';
        message: string;
    };
}

interface PasteAISuccessResponse {
    status: 'ok';
    data: {
        response: string;
        balance: number;
    };
}

type PasteAIImproveResponse = PasteAISuccessResponse | PasteAIErrorResponse;

type NotifyFn = (title: string, body: string) => Promise<void>;

export class ProviderGateway {
    private openAIClient: OpenAI | null = null;
    private openAIKey = '';

    constructor(
        private readonly settingsRepository: SettingsRepository,
        private readonly notify?: NotifyFn
    ) {}

    async warmup(): Promise<void> {
        this.syncOpenAIClient(await this.settingsRepository.getAll());
    }

    async improve(text: string, systemPrompt: string): Promise<string> {
        const settings = await this.settingsRepository.getAll();
        this.syncOpenAIClient(settings);

        switch (settings.llmType) {
            case 'pasteai':
                return this.improveWithPasteAI(text, systemPrompt);
            case 'openai':
                return this.improveWithOpenAI(text, systemPrompt, settings);
            case 'ollama':
                return this.improveWithOllama(text, systemPrompt, settings);
        }
    }

    async checkPasteAIQuota(): Promise<PasteAIQuota> {
        const appId = await this.settingsRepository.ensureAppId();
        const response = await tauriFetch(`https://api.pasteai.app/quota/${appId}`);
        const data = await response.json() as { status: string; data: PasteAIQuota };

        if (data.status !== 'ok') {
            throw new Error('Could not load PasteAI quota');
        }

        return data.data;
    }

    async loginPasteAI(email: string): Promise<string> {
        const appId = await this.settingsRepository.ensureAppId();
        const response = await tauriFetch(`https://api.pasteai.app/login/${email}/${appId}`);
        const data = await response.json() as { status: string; data: { message?: string } };

        if (data.status !== 'ok') {
            throw new Error(data.data.message || 'Could not send verification email');
        }

        return data.data.message || 'Verification email sent';
    }

    async checkOllamaAvailability(url: string): Promise<boolean> {
        try {
            const response = await fetch(`${url}/api/version`);
            return response.ok;
        } catch (error) {
            console.error('Error checking Ollama availability:', error);
            return false;
        }
    }

    async fetchOllamaModels(url: string): Promise<string[]> {
        try {
            const response = await fetch(`${url}/api/tags`);
            if (!response.ok) {
                return [];
            }

            const data = await response.json() as { models?: Array<{ name?: string }> };
            return data.models?.map((model) => model.name).filter((name): name is string => !!name) ?? [];
        } catch (error) {
            console.error('Error fetching Ollama models:', error);
            return [];
        }
    }

    private async improveWithPasteAI(text: string, systemPrompt: string): Promise<string> {
        const appId = await this.settingsRepository.ensureAppId();
        const formData = new FormData();
        formData.append('prompt', systemPrompt);
        formData.append('text', text);

        const response = await tauriFetch(`https://api.pasteai.app/improve/${appId}`, {
            method: 'POST',
            body: formData
        });
        const data = await response.json() as PasteAIImproveResponse;

        if (data.status === 'ok') {
            if (data.data.balance < 3 && this.notify) {
                await this.notify(CONFIG.APP_NAME, 'Almost out of balance, please recharge via https://pasteai.app');
            }

            return data.data.response || text;
        }

        const error = new Error(data.data.message || 'An error occurred') as Error & { data?: PasteAIErrorResponse['data'] };
        error.data = data.data;
        throw error;
    }

    private async improveWithOpenAI(text: string, systemPrompt: string, settings: AppSettings): Promise<string> {
        if (!settings.openaiApiKey.trim()) {
            throw new Error('OpenAI API key missing');
        }

        if (!this.openAIClient) {
            throw new Error('OpenAI client not initialized');
        }

        const completion = await this.openAIClient.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: text }
            ]
        });

        return completion.choices[0].message.content || text;
    }

    private async improveWithOllama(text: string, systemPrompt: string, settings: AppSettings): Promise<string> {
        if (!settings.ollamaUrl.trim()) {
            throw new Error('Ollama URL missing');
        }

        if (!settings.ollamaModel.trim()) {
            throw new Error('Ollama model missing');
        }

        const response = await fetch(`${settings.ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: settings.ollamaModel,
                system: systemPrompt,
                prompt: text,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama request failed with status ${response.status}`);
        }

        const data = await response.json() as { response?: string };
        return data.response || text;
    }

    private syncOpenAIClient(settings: AppSettings): void {
        if (settings.llmType !== 'openai' || !settings.openaiApiKey.trim()) {
            this.openAIClient = null;
            this.openAIKey = '';
            return;
        }

        if (this.openAIClient && this.openAIKey === settings.openaiApiKey) {
            return;
        }

        this.openAIClient = new OpenAI({
            apiKey: settings.openaiApiKey,
            dangerouslyAllowBrowser: true
        });
        this.openAIKey = settings.openaiApiKey;
    }
}
