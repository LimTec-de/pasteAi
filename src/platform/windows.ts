import { listen } from '@tauri-apps/api/event';
import { UserAttentionType, Window } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { APP_EVENTS, type DashboardOpenPayload, type WindowReadyPayload } from '../app/events';
import { WINDOW_CONFIG } from '../config';
import type {
    DashboardSection,
    ManagedWindowId,
    PromptOption,
    StatusDisplayPayload
} from '../domain/types';

interface ManagedWindowDefinition {
    label: ManagedWindowId;
    url: string;
    title: string;
    width: number;
    height: number;
    resizable: boolean;
    alwaysOnTop: boolean;
    transparent: boolean;
    decorations: boolean;
    skipTaskbar: boolean;
    visible: boolean;
}

interface ManagedWindowState {
    window: WebviewWindow;
    created: Promise<void>;
    ready: Promise<void>;
    isReady: boolean;
    resolveReady: () => void;
}

const MANAGED_WINDOWS: Record<ManagedWindowId, ManagedWindowDefinition> = {
    dashboard: {
        label: 'dashboard',
        url: '/dashboard.html',
        title: WINDOW_CONFIG.dashboard.title,
        width: WINDOW_CONFIG.dashboard.width,
        height: WINDOW_CONFIG.dashboard.height,
        resizable: false,
        alwaysOnTop: true,
        transparent: false,
        decorations: false,
        skipTaskbar: false,
        visible: false
    },
    prompt: {
        label: 'prompt',
        url: '/prompt.html',
        title: WINDOW_CONFIG.prompt.title,
        width: WINDOW_CONFIG.prompt.width,
        height: WINDOW_CONFIG.prompt.height,
        resizable: false,
        alwaysOnTop: true,
        transparent: false,
        decorations: false,
        skipTaskbar: false,
        visible: false
    },
    status: {
        label: 'status',
        url: '/status.html',
        title: WINDOW_CONFIG.status.title,
        width: WINDOW_CONFIG.status.width,
        height: WINDOW_CONFIG.status.height,
        resizable: false,
        alwaysOnTop: true,
        transparent: true,
        decorations: false,
        skipTaskbar: true,
        visible: false
    }
};

export class AppWindows {
    private readonly registry = new Map<ManagedWindowId, ManagedWindowState>();
    private initialized = false;

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        await listen<WindowReadyPayload>(APP_EVENTS.WINDOW_READY, (event) => {
            const state = this.registry.get(event.payload.windowId);
            if (state && !state.isReady) {
                state.isReady = true;
                state.resolveReady();
            }
        });

        this.initialized = true;
    }

    async openDashboard(section: DashboardSection): Promise<WebviewWindow> {
        const dashboardWindow = await this.ensureWindow('dashboard');
        const payload: DashboardOpenPayload = { section };
        await dashboardWindow.emit(APP_EVENTS.DASHBOARD_OPEN, payload);
        await this.revealWindow(dashboardWindow, { focus: true, promoteToFront: true });
        return dashboardWindow;
    }

    async prewarmPromptWindow(): Promise<WebviewWindow> {
        return this.ensureWindow('prompt');
    }

    async prewarmStatusWindow(): Promise<WebviewWindow> {
        return this.ensureWindow('status');
    }

    async choosePrompt(): Promise<PromptOption | null> {
        const promptWindow = await this.ensureWindow('prompt');
        const mainWindow = Window.getCurrent();

        const selectionPromise = new Promise<PromptOption | null>((resolve) => {
            let settled = false;
            const cleanupPromises: Array<Promise<() => void>> = [];

            const finish = async (value: PromptOption | null): Promise<void> => {
                if (settled) {
                    return;
                }

                settled = true;
                const cleanup = await Promise.all(cleanupPromises);
                cleanup.forEach((unlisten) => unlisten());
                resolve(value);
            };

            cleanupPromises.push(mainWindow.once<PromptOption>(APP_EVENTS.PROMPT_SELECTED, (event) => {
                void finish(event.payload);
            }));
            cleanupPromises.push(mainWindow.once(APP_EVENTS.PROMPT_CANCELLED, () => {
                void finish(null);
            }));
            cleanupPromises.push(promptWindow.once('tauri://destroyed', () => {
                this.registry.delete('prompt');
                void finish(null);
            }));
        });

        await promptWindow.emit(APP_EVENTS.PROMPT_OPEN);
        await this.revealWindow(promptWindow, { focus: true, promoteToFront: true });

        return selectionPromise;
    }

    async showStatus(payload: StatusDisplayPayload): Promise<void> {
        const statusWindow = await this.ensureWindow('status');
        await statusWindow.emit(APP_EVENTS.STATUS_SHOW, payload);
        await this.revealWindow(statusWindow, { focus: false, promoteToFront: false });
    }

    async hideStatus(): Promise<void> {
        const statusWindow = this.registry.get('status')?.window;
        if (!statusWindow) {
            return;
        }

        await statusWindow.emit(APP_EVENTS.STATUS_HIDE);
    }

    private async ensureWindow(windowId: ManagedWindowId): Promise<WebviewWindow> {
        await this.initialize();

        const state = await this.getOrCreateWindow(windowId);
        await state.created;

        if (!state.isReady) {
            await state.ready;
        }

        return state.window;
    }

    private async getOrCreateWindow(windowId: ManagedWindowId): Promise<ManagedWindowState> {
        const existingState = this.registry.get(windowId);
        if (existingState) {
            return existingState;
        }

        const existingWindow = await WebviewWindow.getByLabel(windowId);
        if (existingWindow) {
            const reusableState: ManagedWindowState = {
                window: existingWindow,
                created: Promise.resolve(),
                ready: Promise.resolve(),
                isReady: true,
                resolveReady: () => undefined
            };

            existingWindow.once('tauri://destroyed', () => {
                this.registry.delete(windowId);
            });

            this.registry.set(windowId, reusableState);
            return reusableState;
        }

        const definition = MANAGED_WINDOWS[windowId];
        let resolveCreated!: () => void;
        let rejectCreated!: (error: unknown) => void;
        let resolveReady!: () => void;

        const created = new Promise<void>((resolve, reject) => {
            resolveCreated = resolve;
            rejectCreated = reject;
        });
        const ready = new Promise<void>((resolve) => {
            resolveReady = resolve;
        });

        const managedWindow = new WebviewWindow(definition.label, {
            url: definition.url,
            title: definition.title,
            width: definition.width,
            height: definition.height,
            resizable: definition.resizable,
            alwaysOnTop: definition.alwaysOnTop,
            transparent: definition.transparent,
            decorations: definition.decorations,
            skipTaskbar: definition.skipTaskbar,
            visible: definition.visible
        });

        const state: ManagedWindowState = {
            window: managedWindow,
            created,
            ready,
            isReady: false,
            resolveReady: () => {
                if (!state.isReady) {
                    state.isReady = true;
                    resolveReady();
                }
            }
        };

        managedWindow.once('tauri://created', () => {
            resolveCreated();
        });
        managedWindow.once('tauri://error', (error) => {
            this.registry.delete(windowId);
            rejectCreated(error);
        });
        managedWindow.once('tauri://destroyed', () => {
            this.registry.delete(windowId);
        });

        this.registry.set(windowId, state);
        return state;
    }

    private async revealWindow(
        windowHandle: WebviewWindow,
        options: { focus: boolean; promoteToFront: boolean }
    ): Promise<void> {
        let originalAlwaysOnTop = true;

        await this.tryWindowCall('unminimize window', () => windowHandle.unminimize());
        originalAlwaysOnTop = await this.tryWindowCall(
            'read always-on-top state',
            () => windowHandle.isAlwaysOnTop(),
            true
        );

        const shouldTemporarilyPromote = options.promoteToFront && !originalAlwaysOnTop;
        if (shouldTemporarilyPromote) {
            await this.tryWindowCall('promote window', () => windowHandle.setAlwaysOnTop(true));
        }

        await this.tryWindowCall('show window', () => windowHandle.show());

        if (options.focus) {
            await this.tryWindowCall('focus window', () => windowHandle.setFocus());
            await this.tryWindowCall(
                'request user attention',
                () => windowHandle.requestUserAttention(UserAttentionType.Informational)
            );
        } else {
            const isVisible = await this.tryWindowCall('read visibility state', () => windowHandle.isVisible(), true);
            if (!isVisible) {
                await this.tryWindowCall(
                    'request user attention',
                    () => windowHandle.requestUserAttention(UserAttentionType.Informational)
                );
            }
        }

        if (shouldTemporarilyPromote) {
            window.setTimeout(() => {
                void this.tryWindowCall('restore always-on-top state', () => windowHandle.setAlwaysOnTop(false));
            }, 120);
        }
    }

    private async tryWindowCall<T>(description: string, action: () => Promise<T>, fallback?: T): Promise<T> {
        try {
            return await action();
        } catch (error) {
            console.warn(`Could not ${description}:`, error);

            if (fallback !== undefined) {
                return fallback;
            }

            return undefined as T;
        }
    }
}
