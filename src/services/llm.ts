import OpenAI from 'openai';
import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { CONFIG } from '../config';
import { NotificationService } from './notifications';
import { Services } from '.';
import { PromptStore } from './prompt-store';

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

type PasteAIResponse = PasteAISuccessResponse | PasteAIErrorResponse;

export class LLMService {
    static async initialize(services: Services) {
        const llmType = await services.store?.get('llm_type') as string;
        if (llmType === 'openai') {
            const apiKey = await services.store?.get('openai_api_key') as string;
            try {
                services.openai = new OpenAI({
                    apiKey,
                    dangerouslyAllowBrowser: true
                });
                console.log('OpenAI client initialized successfully');
            } catch (error) {
                console.error('Error initializing OpenAI:', error);
            }
        }
    }

    static async improveSentence(text: string, services: Services): Promise<string> {
        const llmType = await services.store?.get('llm_type') as string || 'pasteai';
        const selectedPrompt = await PromptStore.getSelectedPrompt();

        try {
            switch (llmType) {
                case 'ollama':
                    return await this.improveWithOllama(text, selectedPrompt.prompt, services);
                case 'openai':
                    return await this.improveWithOpenAI(text, selectedPrompt.prompt, services);
                case 'pasteai':
                    return await this.improveWithPasteAI(text, selectedPrompt.prompt, services);
                default:
                    throw new Error('Invalid LLM type');
            }
        } catch (error) {
            console.error(`Error improving text with ${llmType}:`, error);
            throw error;
        }
    }

    private static async improveWithOllama(text: string, systemPrompt: string, services: Services): Promise<string> {
        const ollamaUrl = await services.store?.get('ollama_url') as string;
        const ollamaModel = await services.store?.get('ollama_model') as string;

        const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: ollamaModel,
                system: systemPrompt,
                prompt: text,
                stream: false
            }),
        });

        const data = await response.json();
        return data.response || text;
    }

    private static async improveWithOpenAI(text: string, systemPrompt: string, services: Services): Promise<string> {
        if (!services.openai) throw new Error('OpenAI client not initialized');

        const completion = await services.openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: text }
            ],
            model: "gpt-4o-mini",
        });

        return completion.choices[0].message.content || text;
    }

    private static async improveWithPasteAI(text: string, systemPrompt: string, services: Services): Promise<string> {
        if (!services.appId) throw new Error('App ID not initialized');

        const formData = new FormData();
        formData.append('prompt', systemPrompt);
        formData.append('text', text);

        const response = await tauriFetch(`https://api.pasteai.app/improve/${services.appId}`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json() as PasteAIResponse;

        if (data.status === 'ok') {
            if (data.data.balance < 3) {
                await NotificationService.notify(CONFIG.APP_NAME, 'Almost out of balance, please recharge via https://pasteai.app');
            }
            return data.data.response || text;
        }

        const error = new Error(data.data.message || 'An error occurred');
        (error as any).data = data.data;
        throw error;
    }
} 