import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

interface UIElements {
    version: HTMLElement | null;
    checkingUpdates: HTMLElement | null;
    installUpdate: HTMLButtonElement | null;
}

function getUIElements(): UIElements {
    return {
        version: document.getElementById('version'),
        checkingUpdates: document.getElementById('checkingUpdates'),
        installUpdate: document.getElementById('installUpdate') as HTMLButtonElement | null
    };
}

async function displayVersion(versionElement: HTMLElement | null) {
    if (!versionElement) return;
    const version = await getVersion();
    versionElement.textContent = `Version: ${version}`;
}

async function handleUpdate(elements: UIElements) {
    const { checkingUpdates, installUpdate } = elements;

    try {
        const update = await check();

        if (!update) {
            if (checkingUpdates) {
                checkingUpdates.textContent = 'No updates available';
            }
            return;
        }

        if (checkingUpdates) {
            checkingUpdates.textContent = `Update available: ${update.version}`;
        }

        if (installUpdate) {
            installUpdate.disabled = false;
            installUpdate.addEventListener('click', () => handleInstallation(update, elements));
        }
    } catch (error) {
        if (checkingUpdates) {
            checkingUpdates.textContent = `Error checking for updates: ${error}`;
        }
    }
}

async function handleInstallation(update: any, elements: UIElements) {
    const { installUpdate, checkingUpdates } = elements;

    if (!installUpdate) return;

    installUpdate.disabled = true;
    installUpdate.textContent = 'Installing update...';

    if (checkingUpdates) {
        checkingUpdates.textContent = 'Installing update...';
    }

    try {
        await update.downloadAndInstall();
        await relaunch();
    } catch (error) {
        if (checkingUpdates) {
            checkingUpdates.textContent = `Error installing update: ${error}`;
        }
        if (installUpdate) {
            installUpdate.disabled = false;
            installUpdate.textContent = 'Retry Installation';
        }
    }
}

async function initializeUI() {
    const elements = getUIElements();
    await displayVersion(elements.version);
    await handleUpdate(elements);
}

window.addEventListener("DOMContentLoaded", initializeUI);