import { AppConfig, WindowConfig } from '../types';

export const CONFIG: AppConfig = {
    MAX_TEXT_LENGTH: 300,
    COPY_DETECTION_INTERVAL: 100,
    COPY_DETECTION_INTERVAL_MAX: 3000,
    COPY_THRESHOLD: 3,
    APP_NAME: 'pasteAI'
};

export const WINDOW_CONFIG: WindowConfig = {
    settings: {
        width: 550,
        height: 800,
        title: 'Settings'
    },
    about: {
        width: 400,
        height: 650,
        title: 'About pasteAI'
    },
    start: {
        width: 700,
        height: 900,
        title: CONFIG.APP_NAME
    },
    status: {
        width: 300,
        height: 50,
        title: 'Status'
    }
}; 