import { invoke } from '@tauri-apps/api/core';

export const LOCAL_LLM_RAM_HINT =
    'About 4 GB of RAM while the model is loaded, plus a 2.5 GB download. Keep that much free. With Parakeet dictation at the same time, plan for about 5 GB.';

export interface LocalLlmStatus {
    installed: boolean;
    downloading: boolean;
    phase: string;
    loaded: boolean;
    bytes: number;
    total: number;
    message: string;
}

export function isLocalLlmMissing(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('On-device rewrite model is not installed');
}

export async function getLocalLlmStatus(): Promise<LocalLlmStatus> {
    return invoke<LocalLlmStatus>('local_llm_status');
}

export async function installLocalLlm(): Promise<void> {
    await invoke('local_llm_install');
}

export async function preloadLocalLlm(): Promise<void> {
    await invoke('local_llm_preload');
}

export async function unloadLocalLlm(): Promise<void> {
    await invoke('local_llm_unload');
}

export async function improveWithLocalLlm(systemPrompt: string, text: string): Promise<string> {
    return invoke<string>('local_llm_improve', { systemPrompt, text });
}
