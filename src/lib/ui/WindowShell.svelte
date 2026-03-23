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
        align-items: flex-start;
        justify-content: space-between;
        gap: 1.25rem;
        min-height: 102px;
        padding: 20px 26px 18px;
        background: linear-gradient(180deg, rgba(255, 252, 246, 0.88) 0%, rgba(248, 242, 232, 0.84) 100%);
        border-bottom: 1px solid rgba(215, 204, 189, 0.92);
        box-shadow: 0 10px 24px rgba(87, 55, 23, 0.06);
        cursor: move;
        user-select: none;
        -webkit-user-select: none;
        -webkit-app-region: drag;
    }

    .window-header--editorial {
        background: linear-gradient(180deg, rgba(255, 252, 246, 0.94) 0%, rgba(245, 236, 223, 0.88) 100%);
    }

    .window-header--focus {
        background: linear-gradient(180deg, rgba(255, 252, 246, 0.9) 0%, rgba(252, 248, 240, 0.84) 100%);
    }

    .window-header__brand {
        display: grid;
        gap: 0.32rem;
        min-width: 0;
    }

    .window-header__row {
        display: flex;
        align-items: flex-start;
        gap: 0.9rem;
    }

    .window-header__mark {
        width: 2.2rem;
        height: 2.2rem;
        border-radius: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, rgba(201, 106, 61, 0.92) 0%, rgba(222, 154, 114, 0.92) 100%);
        color: #fff9f2;
        font-family: var(--font-display);
        font-size: 1.05rem;
        font-weight: 700;
        box-shadow: 0 10px 24px rgba(201, 106, 61, 0.22);
        flex-shrink: 0;
    }

    .window-title-copy {
        display: grid;
        gap: 0.2rem;
        min-width: 0;
    }

    .window-eyebrow {
        display: none;
        color: var(--color-accent-strong);
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.14em;
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
        font-size: 1.9rem;
        font-weight: 600;
        line-height: 1.02;
        letter-spacing: -0.04em;
    }

    .window-subtitle {
        display: none;
        max-width: 42rem;
        margin: 0;
        color: var(--color-muted);
        font-size: 0.93rem;
        line-height: 1.55;
    }

    .window-controls {
        display: flex;
        gap: 0.5rem;
        padding-top: 0.15rem;
        -webkit-app-region: no-drag;
    }

    .window-controls,
    .window-controls * {
        pointer-events: auto;
    }

    .window-controls button {
        width: 32px;
        height: 32px;
        border-radius: 999px;
        border: 1px solid rgba(111, 101, 92, 0.2);
        cursor: pointer;
        transition:
            transform 180ms ease,
            background-color 180ms ease,
            border-color 180ms ease,
            box-shadow 180ms ease;
    }

    .close-btn {
        position: relative;
        background: rgba(255, 250, 242, 0.92);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
    }

    .close-btn::before,
    .close-btn::after {
        content: '';
        position: absolute;
        top: 15px;
        left: 9px;
        width: 12px;
        height: 1.5px;
        background: rgba(87, 55, 23, 0.68);
        border-radius: 999px;
    }

    .close-btn::before {
        transform: rotate(45deg);
    }

    .close-btn::after {
        transform: rotate(-45deg);
    }

    .close-btn:hover {
        background: rgba(201, 106, 61, 0.12);
        border-color: rgba(201, 106, 61, 0.26);
        transform: translateY(-1px);
        box-shadow: 0 10px 24px rgba(201, 106, 61, 0.15);
    }

    @media (max-width: 720px) {
        .window-header {
            padding: 18px 20px 16px;
        }

        .window-title {
            font-size: 1.45rem;
        }

        .window-subtitle {
            font-size: 0.88rem;
        }
    }
</style>
