import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { UIElements } from '../types/about';

export class AboutService {
    static async displayVersion(versionElement: HTMLElement | null) {
        if (!versionElement) return;
        const version = await getVersion();
        versionElement.textContent = `Version: ${version}`;
    }

    static async handleUpdate(elements: UIElements) {
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
                installUpdate.addEventListener('click', () => this.handleInstallation(update, elements));
            }
        } catch (error) {
            if (checkingUpdates) {
                checkingUpdates.textContent = `Error checking for updates: ${error}`;
            }
        }
    }

    private static async handleInstallation(update: any, elements: UIElements) {
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
} 