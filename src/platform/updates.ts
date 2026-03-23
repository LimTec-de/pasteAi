import { Window } from '@tauri-apps/api/window';
import { confirm, message } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import { CONFIG } from '../config';

type NotifyFn = (title: string, body: string) => Promise<void>;

export class UpdateService {
    constructor(private readonly notify: NotifyFn) {}

    async checkForUpdates(shouldNotify: boolean): Promise<void> {
        try {
            const update = await check();

            if (update) {
                const shouldInstall = await confirm(`Update available: ${update.version}. Install?`, {
                    title: CONFIG.APP_NAME,
                    kind: 'info'
                });
                (await Window.getByLabel('main'))?.hide();

                if (shouldInstall) {
                    await update.downloadAndInstall();
                    await relaunch();
                }

                return;
            }

            if (shouldNotify) {
                await message('No update found', {
                    title: CONFIG.APP_NAME,
                    kind: 'info'
                });
                (await Window.getByLabel('main'))?.hide();
            }
        } catch (error) {
            console.error('Error checking for updates:', error);

            if (shouldNotify) {
                await message('Error checking for updates', {
                    title: CONFIG.APP_NAME,
                    kind: 'error'
                });
                (await Window.getByLabel('main'))?.hide();
            } else {
                await this.notify(CONFIG.APP_NAME, 'Error checking for updates');
            }
        }
    }
}
