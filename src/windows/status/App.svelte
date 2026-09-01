<script lang="ts">
    import { emitTo } from '@tauri-apps/api/event';
    import { LogicalSize, Window } from '@tauri-apps/api/window';
    import { onMount, tick } from 'svelte';
    import { APP_EVENTS, type StatusActionPayload, type WindowReadyPayload } from '../../app/events';
    import type { StatusDisplayPayload, StatusType } from '../../domain/types';
    import { centerWindowOnCursorMonitor } from '../../platform/window-placement';

    const RETRY_VISIBLE_AFTER_MS = 4000;

    const STATUS_COPY: Record<StatusType, { label: string; icon: string }> = {
        error: { label: 'Attention', icon: '!' },
        ok: { label: 'Ready', icon: '✓' },
        working: { label: 'Working', icon: '...' },
        info: { label: 'Notice', icon: 'i' }
    };

    let toastElement: HTMLDivElement | null = null;
    let currentPayload: StatusDisplayPayload = {
        message: '',
        type: 'info',
        autohide: true,
        allowHtml: false
    };
    let isVisible = false;
    let hideTimeout: number | null = null;
    let actionSent = false;
    let elapsedSeconds = 0;
    let elapsedStartedAt = 0;
    let elapsedInterval: number | null = null;

    $: statusCopy = STATUS_COPY[currentPayload.type];
    $: hasActions = (currentPayload.actions?.length ?? 0) > 0;
    $: isWorking = currentPayload.type === 'working';
    $: isCancellable = Boolean(currentPayload.cancellable);
    $: showRetry = isCancellable && elapsedSeconds * 1000 >= RETRY_VISIBLE_AFTER_MS;
    $: toastTitle = isWorking ? 'Currently improving' : undefined;

    async function display(payload: StatusDisplayPayload): Promise<void> {
        const payloadHasActions = (payload.actions?.length ?? 0) > 0;
        if (isVisible && hasActions && !actionSent) {
            await sendAction('skip');
        }

        actionSent = false;
        currentPayload = {
            autohide: true,
            allowHtml: false,
            cancellable: false,
            ...payload
        };
        isVisible = true;

        if (currentPayload.type === 'working') {
            startElapsed();
        } else {
            stopElapsed();
        }

        await tick();
        await resizeWindow();

        if (hideTimeout !== null) {
            window.clearTimeout(hideTimeout);
        }

        if (currentPayload.autohide) {
            const delay = payloadHasActions ? 20000 : (currentPayload.type === 'error' ? 10000 : 1200);
            hideTimeout = window.setTimeout(async () => {
                if (payloadHasActions && !actionSent) {
                    await sendAction('skip');
                }
                await hide();
            }, delay);
        } else {
            hideTimeout = null;
        }
    }

    function startElapsed(): void {
        stopElapsed();
        elapsedStartedAt = Date.now();
        elapsedSeconds = 0;
        elapsedInterval = window.setInterval(() => {
            const nextSeconds = Math.floor((Date.now() - elapsedStartedAt) / 1000);
            const retryAppeared = Boolean(currentPayload.cancellable)
                && elapsedSeconds * 1000 < RETRY_VISIBLE_AFTER_MS
                && nextSeconds * 1000 >= RETRY_VISIBLE_AFTER_MS;
            elapsedSeconds = nextSeconds;
            if (retryAppeared) {
                void tick().then(() => resizeWindow());
            }
        }, 1000);
    }

    function stopElapsed(): void {
        if (elapsedInterval !== null) {
            window.clearInterval(elapsedInterval);
            elapsedInterval = null;
        }

        elapsedSeconds = 0;
        elapsedStartedAt = 0;
    }

    async function sendAction(action: StatusActionPayload['action']): Promise<void> {
        if (actionSent) {
            return;
        }

        actionSent = true;
        await emitTo('main', APP_EVENTS.STATUS_ACTION, { action });
    }

    async function handleAction(action: 'add' | 'skip'): Promise<void> {
        if (hideTimeout !== null) {
            window.clearTimeout(hideTimeout);
            hideTimeout = null;
        }

        await sendAction(action);
        await hide();
    }

    async function handleCancel(): Promise<void> {
        await emitTo('main', APP_EVENTS.STATUS_ACTION, { action: 'cancel' });
        await hide();
    }

    async function handleRetry(): Promise<void> {
        await emitTo('main', APP_EVENTS.STATUS_ACTION, { action: 'retry' });
        startElapsed();
        await tick();
        await resizeWindow();
    }

    async function hide(): Promise<void> {
        stopElapsed();
        isVisible = false;
        await Window.getCurrent().hide();
    }

    async function resizeWindow(): Promise<void> {
        if (!toastElement) {
            return;
        }

        const rect = toastElement.getBoundingClientRect();
        const maxHeight = hasActions ? 360 : 204;
        const statusWindow = Window.getCurrent();
        await statusWindow.setSize(
            new LogicalSize(
                Math.min(Math.max(rect.width + 26, 344), 544),
                Math.min(Math.max(rect.height + 26, 96), maxHeight)
            )
        );
        await centerWindowOnCursorMonitor(statusWindow);
    }

    onMount(() => {
        let unlistenShow: (() => void) | undefined;
        let unlistenHide: (() => void) | undefined;

        void (async () => {
            unlistenShow = await Window.getCurrent().listen<StatusDisplayPayload>(APP_EVENTS.STATUS_SHOW, (event) => {
                void display(event.payload);
            });
            unlistenHide = await Window.getCurrent().listen(APP_EVENTS.STATUS_HIDE, () => {
                void hide();
            });

            const payload: WindowReadyPayload = { windowId: 'status' };
            await emitTo('main', APP_EVENTS.WINDOW_READY, payload);
        })();

        return () => {
            unlistenShow?.();
            unlistenHide?.();
            stopElapsed();

            if (hideTimeout !== null) {
                window.clearTimeout(hideTimeout);
            }
        };
    });
</script>

<div
    class={`status-toast ${isVisible ? `is-visible status-toast--${currentPayload.type}` : ''}`}
    bind:this={toastElement}
    role="status"
    aria-live="polite"
    title={toastTitle}
>
    <div class="status-toast__accent"></div>
    <div class="status-toast__icon">
        {#if isWorking}
            <span class="status-toast__spinner" aria-hidden="true"></span>
        {:else}
            {statusCopy.icon}
        {/if}
    </div>
    <div class="status-toast__body">
        <div class="status-toast__header">
            <div class="status-toast__label">{statusCopy.label}</div>
            {#if isWorking}
                <span class="status-toast__elapsed">{elapsedSeconds}s</span>
            {/if}
            {#if isCancellable}
                <div class="status-toast__controls">
                    {#if showRetry}
                        <button
                            type="button"
                            class="status-toast__icon-btn"
                            title="Retry"
                            aria-label="Retry"
                            on:click={() => void handleRetry()}
                        >
                            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                                <path
                                    fill="currentColor"
                                    d="M8 3a5 5 0 1 0 4.55 3.03.75.75 0 1 1 1.36-.64A6.5 6.5 0 1 1 8 1.5V.28a.25.25 0 0 1 .4-.2l2.2 1.47a.25.25 0 0 1 0 .4L8.4 3.42A.25.25 0 0 1 8 3.22V3z"
                                />
                            </svg>
                        </button>
                    {/if}
                    <button
                        type="button"
                        class="status-toast__icon-btn"
                        title="Cancel"
                        aria-label="Cancel"
                        on:click={() => void handleCancel()}
                    >
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                            <path
                                fill="currentColor"
                                d="M3.22 3.22a.75.75 0 0 1 1.06 0L8 6.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L9.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06L8 9.06l-3.72 3.72a.75.75 0 1 1-1.06-1.06L6.94 8 3.22 4.28a.75.75 0 0 1 0-1.06z"
                            />
                        </svg>
                    </button>
                </div>
            {/if}
        </div>
        <div class="status-toast__message">
            {#if currentPayload.allowHtml}
                {@html currentPayload.message}
            {:else}
                {currentPayload.message}
            {/if}
        </div>
        {#if currentPayload.pairs && currentPayload.pairs.length > 0}
            <ul class="status-toast__pairs">
                {#each currentPayload.pairs as pair}
                    <li><span>{pair.from}</span> → <strong>{pair.to}</strong></li>
                {/each}
            </ul>
        {/if}
        {#if currentPayload.actions && currentPayload.actions.length > 0}
            <div class="status-toast__actions">
                {#each currentPayload.actions as action}
                    <button
                        type="button"
                        class={action.id === 'add' ? 'status-toast__action status-toast__action--primary' : 'status-toast__action'}
                        on:click={() => void handleAction(action.id)}
                    >
                        {action.label}
                    </button>
                {/each}
            </div>
        {/if}
    </div>
</div>
