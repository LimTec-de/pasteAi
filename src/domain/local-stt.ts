import { invoke } from '@tauri-apps/api/core';

export interface LocalSttStatus {
    installed: boolean;
    downloading: boolean;
    phase: string;
    loaded: boolean;
    bytes: number;
    total: number;
    message: string;
}

export async function getLocalSttStatus(): Promise<LocalSttStatus> {
    return invoke<LocalSttStatus>('local_stt_status');
}

export async function installLocalStt(): Promise<void> {
    await invoke('local_stt_install');
}

export async function preloadLocalStt(): Promise<void> {
    await invoke('local_stt_preload');
}

export async function transcribeLocalStt(pcm: Uint8Array, sampleRate: number): Promise<string> {
    return invoke<string>('local_stt_transcribe', {
        pcm: Array.from(pcm),
        sampleRate
    });
}
