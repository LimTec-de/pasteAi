import { UIElements } from '../types/about';

export function getUIElements(): UIElements {
    return {
        version: document.getElementById('version'),
        checkingUpdates: document.getElementById('checkingUpdates'),
        installUpdate: document.getElementById('installUpdate') as HTMLButtonElement | null
    };
} 