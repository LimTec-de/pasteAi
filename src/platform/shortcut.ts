export const DEFAULT_DICTATE_SHORTCUT = 'CommandOrControl+Shift+Space';

export function keyboardEventToAccelerator(event: KeyboardEvent): string | null {
    if (event.repeat || isModifierKey(event.key)) {
        return null;
    }

    const hasCommandOrControl = event.metaKey || event.ctrlKey;
    if (!hasCommandOrControl && !event.altKey) {
        return null;
    }

    const key = acceleratorKey(event);
    if (!key) {
        return null;
    }

    const parts: string[] = [];
    if (hasCommandOrControl) {
        parts.push('CommandOrControl');
    }
    if (event.altKey) {
        parts.push('Alt');
    }
    if (event.shiftKey) {
        parts.push('Shift');
    }
    parts.push(key);

    return parts.join('+');
}

const PRIMARY_MODIFIERS = new Set(['commandorcontrol', 'command', 'control', 'cmd', 'ctrl']);
const EXTRA_MODIFIERS = new Set(['shift', 'alt', 'option']);

export function isForbiddenDictateShortcut(accelerator: string): boolean {
    const parts = accelerator.replace(/\s/g, '').split('+').filter(Boolean);
    if (parts.length < 2) {
        return false;
    }

    const mods = parts.slice(0, -1).map((part) => part.toLowerCase());
    const hasPrimary = mods.some((mod) => PRIMARY_MODIFIERS.has(mod));
    const hasExtra = mods.some((mod) => EXTRA_MODIFIERS.has(mod));
    return hasPrimary && !hasExtra;
}

export function formatAcceleratorForDisplay(accelerator: string): string {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || navigator.userAgent.includes('Mac OS');
    const parts = accelerator.split('+').map((part) => {
        if (part === 'CommandOrControl' || part === 'Command' || part === 'Cmd') {
            return isMac ? '⌘' : 'Ctrl';
        }
        if (part === 'Control' || part === 'Ctrl') {
            return isMac ? '⌃' : 'Ctrl';
        }
        if (part === 'Alt' || part === 'Option') {
            return isMac ? '⌥' : 'Alt';
        }
        if (part === 'Shift') {
            return isMac ? '⇧' : 'Shift';
        }
        if (part === 'Space') {
            return 'Space';
        }

        return part;
    });

    return isMac ? parts.join('') : parts.join('+');
}

function isModifierKey(key: string): boolean {
    return key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta';
}

function acceleratorKey(event: KeyboardEvent): string | null {
    if (event.key === ' ') {
        return 'Space';
    }

    const namedKeys: Record<string, string> = {
        ArrowUp: 'Up',
        ArrowDown: 'Down',
        ArrowLeft: 'Left',
        ArrowRight: 'Right',
        Escape: 'Esc',
        Enter: 'Return',
        Tab: 'Tab',
        Backspace: 'Backspace',
        Delete: 'Delete',
        Home: 'Home',
        End: 'End',
        PageUp: 'PageUp',
        PageDown: 'PageDown'
    };

    if (namedKeys[event.key]) {
        return namedKeys[event.key];
    }

    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) {
        return event.key;
    }

    if (event.key.length === 1 && /[a-z0-9]/i.test(event.key)) {
        return event.key.toUpperCase();
    }

    return null;
}
