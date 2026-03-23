<script lang="ts">
    import { emitTo } from '@tauri-apps/api/event';
    import { LogicalSize, Window } from '@tauri-apps/api/window';
    import { onMount, tick } from 'svelte';
    import { APP_EVENTS, type WindowReadyPayload } from '../../app/events';
    import type { StatusDisplayPayload, StatusType } from '../../domain/types';

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

    $: statusCopy = STATUS_COPY[currentPayload.type];

    async function display(payload: StatusDisplayPayload): Promise<void> {
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
            hideTimeout = window.setTimeout(async () => {
                await hide();
            }, currentPayload.type === 'error' ? 10000 : 1200);
        } else {
            hideTimeout = null;
        }
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
        await Window.getCurrent().setSize(
            new LogicalSize(
                Math.min(Math.max(rect.width + 26, 344), 544),
                Math.min(Math.max(rect.height + 26, 96), 204)
            )
        );
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
    </div>
</div>
