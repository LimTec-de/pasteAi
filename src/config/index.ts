export interface AppConfig {
    MAX_TEXT_LENGTH: number;
    COPY_DETECTION_INTERVAL: number;
    COPY_DETECTION_INTERVAL_MAX: number;
    COPY_THRESHOLD: number;
    APP_NAME: string;
}

export interface WindowConfig {
    dashboard: {
        width: number;
        height: number;
        title: string;
    };
    status: {
        width: number;
        height: number;
        title: string;
    };
    'prompt': {
        width: number;
        height: number;
        title: string;
    };
}

export const CONFIG: AppConfig = {
    MAX_TEXT_LENGTH: 3000,
    COPY_DETECTION_INTERVAL: 100,
    COPY_DETECTION_INTERVAL_MAX: 3000,
    COPY_THRESHOLD: 3,
    APP_NAME: 'pasteAI'
};

export const WINDOW_CONFIG: WindowConfig = {
    dashboard: {
        width: 980,
        height: 820,
        title: CONFIG.APP_NAME
    },
    status: {
        width: 360,
        height: 92,
        title: 'Status'
    },
    'prompt': {
        width: 720,
        height: 560,
        title: 'Select a Prompt'
    }
};
