import { UnlistenFn } from "@tauri-apps/api/event";
import OpenAI from 'openai';

export interface AppConfig {
    MAX_TEXT_LENGTH: number;
    COPY_DETECTION_INTERVAL: number;
    COPY_DETECTION_INTERVAL_MAX: number;
    COPY_THRESHOLD: number;
    APP_NAME: string;
}

export interface WindowConfig {
    settings: {
        width: number;
        height: number;
        title: string;
    };
    about: {
        width: number;
        height: number;
        title: string;
    };
    start: {
        width: number;
        height: number;
        title: string;
    };
    status: {
        width: number;
        height: number;
        title: string;
    };
}

export interface AppError extends Error {
    stack?: string;
    message: string;
}

export interface Services {
    openai?: OpenAI;
    store?: Awaited<ReturnType<typeof import('@tauri-apps/plugin-store').load>>;
    unlistenTextUpdate?: UnlistenFn;
    unlistenClipboard?: () => Promise<void>;
    appId?: string;
} 