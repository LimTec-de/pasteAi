import { invoke } from '@tauri-apps/api/core';
import { fallbackSpeechLanguageCatalog, type SpeechLanguageCatalog } from './types';

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

export async function startAppleDictation(languages: string[], deviceUid?: string): Promise<void> {
    await invoke('apple_dictation_start', { languages, deviceUid });
}

export async function listSpeechLanguages(): Promise<SpeechLanguageCatalog> {
    try {
        const catalog = await invoke<SpeechLanguageCatalog>('apple_list_speech_languages');
        if (catalog.languages.length > 0) {
            return {
                languages: catalog.languages,
                maxActiveLanguages: Math.max(1, catalog.maxActiveLanguages || 2)
            };
        }
    } catch (error) {
        console.warn('Could not list Apple speech languages:', error);
    }

    return fallbackSpeechLanguageCatalog();
}

export async function installSpeechLanguage(code: string): Promise<void> {
    await invoke('apple_install_speech_language', { code });
}

export async function stopAppleDictation(): Promise<string> {
    return invoke<string>('apple_dictation_stop');
}

export async function cancelAppleDictation(): Promise<void> {
    await invoke('apple_dictation_cancel');
}

export interface AudioInputDevice {
    id: string;
    label: string;
}

export async function listAppleInputDevices(): Promise<AudioInputDevice[]> {
    return invoke<AudioInputDevice[]>('apple_list_input_devices');
}
