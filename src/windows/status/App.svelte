<script lang="ts">
    import { emitTo } from '@tauri-apps/api/event';
    import { LogicalSize, Window } from '@tauri-apps/api/window';
    import { onMount, tick } from 'svelte';
    import { APP_EVENTS, type WindowReadyPayload } from '../../app/events';
    import type { StatusDisplayPayload, StatusType } from '../../domain/types';
    import { centerWindowOnCursorMonitor } from '../../platform/window-placement';

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

    $: statusCopy = STATUS_COPY[currentPayload.type];
    $: hasActions = (currentPayload.actions?.length ?? 0) > 0;

    async function display(payload: StatusDisplayPayload): Promise<void> {
        const payloadHasActions = (payload.actions?.length ?? 0) > 0;
        if (isVisible && hasActions && !actionSent) {
            await sendAction('skip');
        }

        actionSent = false;
        currentPayload = {
            autohide: true,
            allowHtml: false,
            ...payload
        };
        isVisible = true;

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

    async function sendAction(action: 'add' | 'skip'): Promise<void> {
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

    async function hide(): Promise<void> {
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

            if (hideTimeout !== null) {
                window.clearTimeout(hideTimeout);
            }
        };
    });
</script>

<div class={`status-toast ${isVisible ? `is-visible status-toast--${currentPayload.type}` : ''}`} bind:this={toastElement} role="status" aria-live="polite">
    <div class="status-toast__accent"></div>
    <div class="status-toast__icon">{statusCopy.icon}</div>
    <div class="status-toast__body">
        <div class="status-toast__label">{statusCopy.label}</div>
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
