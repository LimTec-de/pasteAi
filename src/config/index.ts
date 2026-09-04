export interface AppConfig {
    MAX_TEXT_LENGTH: number;
    MAX_HTML_LENGTH: number;
    COPY_DETECTION_INTERVAL: number;
    COPY_DETECTION_INTERVAL_MAX: number;
    COPY_THRESHOLD: number;
    TRIGGER_PREFIX: string;
    APP_NAME: string;
    DEFAULT_DICTATE_SHORTCUT: string;
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
    promptExtra: {
        width: number;
        height: number;
        title: string;
    };
    answer: {
        width: number;
        height: number;
        title: string;
    };
    dictate: {
        width: number;
        height: number;
        title: string;
    };
}

export const CONFIG: AppConfig = {
    MAX_TEXT_LENGTH: 3000,
    MAX_HTML_LENGTH: 20000,
    COPY_DETECTION_INTERVAL: 100,
    COPY_DETECTION_INTERVAL_MAX: 3000,
    COPY_THRESHOLD: 3,
    TRIGGER_PREFIX: 'pasteai:',
    APP_NAME: 'pasteAI',
    DEFAULT_DICTATE_SHORTCUT: 'CommandOrControl+Shift+Space'
};

export const SHELL_INSTALL_COMMANDS: Record<'bash' | 'zsh', string> = {
    bash: `printf '\\n%s\\n' 'p(){ printf "\\033]52;c;%s\\007" "$(printf "pasteai:shell:%s" "$*" | base64 | tr -d "\\n")"; }' >> ~/.bashrc && source ~/.bashrc`,
    zsh: `printf '\\n%s\\n' 'p(){ printf "\\033]52;c;%s\\007" "$(printf "pasteai:shell:%s" "$*" | base64 | tr -d "\\n")"; }' >> ~/.zshrc && source ~/.zshrc`
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
        height: 620,
        title: 'Select a Prompt'
    },
    promptExtra: {
        width: 520,
        height: 260,
        title: 'Additional instruction'
    },
    answer: {
        width: 620,
        height: 480,
        title: 'pasteAI Result'
    },
    dictate: {
        width: 380,
        height: 360,
        title: 'Dictate'
    }
};
