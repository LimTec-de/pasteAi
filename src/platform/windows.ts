import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LogicalSize, UserAttentionType, Window } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { APP_EVENTS, type AnswerDisplayPayload, type DashboardOpenPayload, type DictateOpenPayload, type PromptOpenPayload, type WindowReadyPayload } from '../app/events';
import { WINDOW_CONFIG } from '../config';
import { centerWindowOnCursorMonitor } from './window-placement';
import type {
    DashboardSection,
    ManagedWindowId,
    PromptChoice,
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
    focus?: boolean;
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
    },
    answer: {
        label: 'answer',
        url: '/answer.html',
        title: WINDOW_CONFIG.answer.title,
        width: WINDOW_CONFIG.answer.width,
        height: WINDOW_CONFIG.answer.height,
        resizable: true,
        alwaysOnTop: true,
        transparent: false,
        decorations: false,
        skipTaskbar: false,
        visible: false
    },
    dictate: {
        label: 'dictate',
        url: '/dictate.html',
        title: WINDOW_CONFIG.dictate.title,
        width: WINDOW_CONFIG.dictate.width,
        height: WINDOW_CONFIG.dictate.height,
        resizable: false,
        alwaysOnTop: true,
        transparent: false,
        decorations: false,
        skipTaskbar: true,
        visible: false,
        focus: false
    }
};

const CURSOR_CENTERED_WINDOWS = new Set<ManagedWindowId>(['status', 'answer', 'prompt', 'dictate']);

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

    async prewarmAnswerWindow(): Promise<WebviewWindow> {
        return this.ensureWindow('answer');
    }

    async prewarmDictateWindow(): Promise<WebviewWindow> {
        return this.ensureWindow('dictate');
    }

    async choosePrompt(options: { mode: 'full' | 'extra'; preselected?: PromptOption } = { mode: 'full' }): Promise<PromptChoice | null> {
        await invoke('remember_frontmost_app').catch((error) => {
            console.warn('Could not remember frontmost app:', error);
        });

        const promptWindow = await this.ensureWindow('prompt');
        const mainWindow = Window.getCurrent();

        const selectionPromise = new Promise<PromptChoice | null>((resolve) => {
            let settled = false;
            const cleanupPromises: Array<Promise<() => void>> = [];

            const finish = async (value: PromptChoice | null): Promise<void> => {
                if (settled) {
                    return;
                }

                settled = true;
                const cleanup = await Promise.all(cleanupPromises);
                cleanup.forEach((unlisten) => unlisten());
                resolve(value);
            };

            cleanupPromises.push(mainWindow.once<PromptChoice>(APP_EVENTS.PROMPT_SELECTED, (event) => {
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

        const size = options.mode === 'extra' ? WINDOW_CONFIG.promptExtra : WINDOW_CONFIG.prompt;
        await this.tryWindowCall('resize prompt window', () => promptWindow.setSize(
            new LogicalSize(size.width, size.height)
        ));
        await this.revealWindow(promptWindow, { focus: true, promoteToFront: true });
        await invoke('activate_this_app').catch((error) => {
            console.warn('Could not activate pasteAI:', error);
        });
        const payload: PromptOpenPayload = {
            mode: options.mode,
            preselected: options.preselected
        };
        await promptWindow.emit(APP_EVENTS.PROMPT_OPEN, payload);

        return selectionPromise;
    }

    async showDictate(payload: DictateOpenPayload): Promise<void> {
        const dictateWindow = await this.ensureWindow('dictate');
        await this.tryWindowCall('resize dictate window', () => dictateWindow.setSize(
            new LogicalSize(WINDOW_CONFIG.dictate.width, WINDOW_CONFIG.dictate.height)
        ));
        await dictateWindow.emit(APP_EVENTS.DICTATE_OPEN, payload);
        await this.revealWindow(dictateWindow, { focus: false, promoteToFront: true });
    }

    async provideDictateSession(clientSecret: string): Promise<void> {
        const dictateWindow = this.registry.get('dictate')?.window;
        if (!dictateWindow) {
            return;
        }

        await dictateWindow.emit(APP_EVENTS.DICTATE_SESSION, { clientSecret });
    }

    async markDictateReady(): Promise<void> {
        const dictateWindow = this.registry.get('dictate')?.window;
        if (!dictateWindow) {
            return;
        }

        await dictateWindow.emit(APP_EVENTS.DICTATE_READY);
    }

    async latchDictate(): Promise<void> {
        const dictateWindow = this.registry.get('dictate')?.window;
        if (!dictateWindow) {
            return;
        }

        await dictateWindow.emit(APP_EVENTS.DICTATE_LATCH);
    }

    async hideDictate(): Promise<void> {
        const dictateWindow = this.registry.get('dictate')?.window;
        if (!dictateWindow) {
            return;
        }

        await dictateWindow.emit(APP_EVENTS.DICTATE_HIDE);
        await this.tryWindowCall('hide dictate window', () => dictateWindow.hide());
    }

    async requestDictateFinish(): Promise<void> {
        const dictateWindow = this.registry.get('dictate')?.window;
        if (!dictateWindow) {
            return;
        }

        await dictateWindow.emit(APP_EVENTS.DICTATE_FINISH);
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

    async showAnswer(text: string): Promise<void> {
        const answerWindow = await this.ensureWindow('answer');
        const payload: AnswerDisplayPayload = { text };
        await answerWindow.emit(APP_EVENTS.ANSWER_SHOW, payload);
        await invoke('remember_frontmost_app').catch((error) => {
            console.warn('Could not remember frontmost app:', error);
        });
        await this.revealWindow(answerWindow, { focus: true, promoteToFront: true });
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
            visible: definition.visible,
            focus: definition.focus
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

        const windowLabel = windowHandle.label as ManagedWindowId;
        if (CURSOR_CENTERED_WINDOWS.has(windowLabel)) {
            await centerWindowOnCursorMonitor(windowHandle);
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
