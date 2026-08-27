import { invoke } from '@tauri-apps/api/core';

export interface AppleAvailability {
    available: boolean;
    reasonCode: string;
    message: string;
}

export const UNAVAILABLE_ON_MAC: AppleAvailability = {
    available: false,
    reasonCode: 'notMac',
    message: 'Only available on Mac.'
};

export async function getAppleTextAvailability(): Promise<AppleAvailability> {
    return invoke<AppleAvailability>('apple_text_availability');
}

export async function getAppleSpeechAvailability(): Promise<AppleAvailability> {
    return invoke<AppleAvailability>('apple_speech_availability');
}

export async function improveWithApple(systemPrompt: string, text: string): Promise<string> {
    return invoke<string>('apple_improve', { systemPrompt, text });
}

export async function startAppleDictation(): Promise<void> {
    await invoke('apple_dictation_start');
}

export async function stopAppleDictation(): Promise<string> {
    return invoke<string>('apple_dictation_stop');
}

export async function cancelAppleDictation(): Promise<void> {
    await invoke('apple_dictation_cancel');
}
