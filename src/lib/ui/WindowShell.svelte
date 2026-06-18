<script lang="ts">
    import { Window } from '@tauri-apps/api/window';

    export let title = '';
    export let eyebrow = '';
    export let subtitle = '';
    export let variant: 'utility' | 'editorial' | 'focus' = 'utility';
    export let onClose: (() => Promise<void> | void) | undefined = undefined;

    async function handleClose(): Promise<void> {
        if (onClose) {
            await onClose();
            return;
        }

        await Window.getCurrent().hide();
    }
</script>

<div class="window-shell">
    <header class={`window-header window-header--${variant}`} data-tauri-drag-region>
        <div class="window-header__brand">
            {#if eyebrow}
                <div class="window-eyebrow is-visible">{eyebrow}</div>
            {/if}
            <div class="window-header__row">
                <div class="window-header__mark" aria-hidden="true">PA</div>
                <div class="window-title-copy">
                    <h1 class="window-title">{title}</h1>
                    {#if subtitle}
                        <p class="window-subtitle is-visible">{subtitle}</p>
                    {/if}
                </div>
            </div>
        </div>
        <div class="window-controls">
            <button type="button" class="close-btn" aria-label="Close" on:click={() => void handleClose()}></button>
        </div>
    </header>

    <slot />
</div>

<style>
    .window-shell {
        position: relative;
        z-index: 1;
    }

    .window-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.25rem;
        min-height: 60px;
        padding: 12px 22px;
        background: var(--color-surface);
        border-bottom: 1px solid var(--color-border);
        cursor: move;
        user-select: none;
        -webkit-user-select: none;
        -webkit-app-region: drag;
    }

    .window-header__brand {
        display: grid;
        gap: 0.15rem;
        min-width: 0;
    }

    .window-header__row {
        display: flex;
        align-items: center;
        gap: 0.7rem;
    }

    .window-header__mark {
        width: 1.85rem;
        height: 1.85rem;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--color-accent);
        color: #ffffff;
        font-family: var(--font-display);
        font-size: 0.82rem;
        font-weight: 700;
        flex-shrink: 0;
    }

    .window-title-copy {
        display: grid;
        gap: 0.1rem;
        min-width: 0;
    }

    .window-eyebrow {
        display: none;
        color: var(--color-accent-strong);
        font-size: 0.66rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }

    .window-eyebrow.is-visible,
    .window-subtitle.is-visible {
        display: block;
    }

    .window-title {
        margin: 0;
        color: var(--color-text);
        font-family: var(--font-display);
        font-size: 1.05rem;
        font-weight: 650;
        line-height: 1.1;
        letter-spacing: -0.01em;
    }

    .window-subtitle {
        display: none;
        max-width: 42rem;
        margin: 0;
        color: var(--color-muted);
        font-size: 0.85rem;
        line-height: 1.5;
    }

    .window-controls {
        display: flex;
        gap: 0.5rem;
        -webkit-app-region: no-drag;
    }

    .window-controls,
    .window-controls * {
        pointer-events: auto;
    }

    .window-controls button {
        width: 30px;
        height: 30px;
        border-radius: 8px;
        border: 1px solid var(--color-border);
        cursor: pointer;
        transition:
            background-color var(--transition-standard),
            border-color var(--transition-standard);
    }

    .close-btn {
        position: relative;
        background: var(--color-surface);
    }

    .close-btn::before,
    .close-btn::after {
        content: '';
        position: absolute;
        top: 14px;
        left: 9px;
        width: 11px;
        height: 1.5px;
        background: var(--color-muted);
        border-radius: 999px;
    }

    .close-btn::before {
        transform: rotate(45deg);
    }

    .close-btn::after {
        transform: rotate(-45deg);
    }

    .close-btn:hover {
        background: var(--color-surface-raised);
        border-color: var(--color-border-strong);
    }
</style>
