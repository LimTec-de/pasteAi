import { getVersion } from '@tauri-apps/api/app';
import { emit } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

async function initializeUI() {
    const version = await getVersion();
    const versionElement = document.getElementById('version');
    if (versionElement) {
        versionElement.textContent = `Version: ${version}`;
    }

    const checkUpdates = document.getElementById('checkUpdates') as HTMLButtonElement;
    const checkingUpdates = document.getElementById('checkingUpdates');
    const installUpdate = document.getElementById('installUpdate') as HTMLButtonElement;


    try {
        const update = await check();

        if (update) {
            if (checkingUpdates) {
                checkingUpdates.textContent = `Update available: ${update.version}`;
            }
            if (installUpdate) {
                installUpdate.disabled = false;
                installUpdate.addEventListener('click', async () => {
                    installUpdate.disabled = true;
                    installUpdate.textContent = 'Installing update...';
                    if (checkingUpdates) {
                        checkingUpdates.textContent = 'Installing update...';
                    }
                    await update.downloadAndInstall();
                    await relaunch();
                });
            }
        } else {
            if (checkingUpdates) {
                checkingUpdates.textContent = 'No updates available';
            }
        }
    } catch (error) {
        if (checkingUpdates) {
            checkingUpdates.textContent = `Error checking for updates: ${error}`;
        }
    }

}

window.addEventListener("DOMContentLoaded", async () => {
    await initializeUI();
});