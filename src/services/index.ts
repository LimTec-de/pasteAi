import { UnlistenFn } from "@tauri-apps/api/event";
import OpenAI from 'openai';

export interface Services {
    openai?: OpenAI;
    store?: Awaited<ReturnType<typeof import('@tauri-apps/plugin-store').load>>;
    unlistenTextUpdate?: UnlistenFn;
    unlistenClipboard?: () => Promise<void>;
    appId?: string;
}

export * from './window';
export * from './llm';
export * from './tray';
export * from './update';
export * from './clipboard';
export * from './prompt-store';
// export * from './prompt'; 