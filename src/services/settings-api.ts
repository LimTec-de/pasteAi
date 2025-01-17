import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export class SettingsAPIService {
    static async fetchOllamaModels(url: string): Promise<string[]> {
        try {
            const response = await fetch(`${url}/api/tags`);
            const data = await response.json();
            return data.models?.map((model: any) => model.name) || [];
        } catch (error) {
            console.error('Error fetching Ollama models:', error);
            return [];
        }
    }

    static async checkOllamaAvailability(url: string): Promise<boolean> {
        try {
            const response = await fetch(`${url}/api/version`);
            return response.status === 200;
        } catch (error) {
            console.error('Error checking Ollama availability:', error);
            return false;
        }
    }

    static async checkQuota(appId: string): Promise<{ status: string; data: { balance: number; email: string | null } }> {
        const response = await tauriFetch(`https://api.pasteai.app/quota/${appId}`);
        return response.json();
    }

    static async loginUser(email: string, appId: string): Promise<{ status: string; data: { message: string } }> {
        const response = await tauriFetch(`https://api.pasteai.app/login/${email}/${appId}`);
        return response.json();
    }
} 