import type {
    DashboardSection,
    ManagedWindowId,
    PromptOption,
    StatusDisplayPayload
} from '../domain/types';

export const APP_EVENTS = {
    WINDOW_READY: 'app:window-ready',
    DASHBOARD_OPEN: 'dashboard:open',
    PROMPT_OPEN: 'prompt:open',
    PROMPT_SELECTED: 'prompt:selected',
    PROMPT_CANCELLED: 'prompt:cancelled',
    STATUS_SHOW: 'status:show',
    STATUS_HIDE: 'status:hide',
    SETTINGS_CHANGED: 'settings:changed',
    PROMPTS_CHANGED: 'prompts:changed'
} as const;

export interface WindowReadyPayload {
    windowId: ManagedWindowId;
}

export interface DashboardOpenPayload {
    section: DashboardSection;
}

export interface AppEventPayloads {
    [APP_EVENTS.WINDOW_READY]: WindowReadyPayload;
    [APP_EVENTS.DASHBOARD_OPEN]: DashboardOpenPayload;
    [APP_EVENTS.PROMPT_OPEN]: undefined;
    [APP_EVENTS.PROMPT_SELECTED]: PromptOption;
    [APP_EVENTS.PROMPT_CANCELLED]: undefined;
    [APP_EVENTS.STATUS_SHOW]: StatusDisplayPayload;
    [APP_EVENTS.STATUS_HIDE]: undefined;
    [APP_EVENTS.SETTINGS_CHANGED]: undefined;
    [APP_EVENTS.PROMPTS_CHANGED]: undefined;
}
