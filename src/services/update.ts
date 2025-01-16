import { check } from '@tauri-apps/plugin-updater';
import { message, confirm } from '@tauri-apps/plugin-dialog';
import { Window } from '@tauri-apps/api/window';
import { relaunch } from '@tauri-apps/plugin-process';
import { CONFIG } from '../config';
import { NotificationService } from './notifications';

export class UpdateManager {
    static async checkUpdate(shouldNotify: boolean) {
        try {
            const update = await check();

            if (update) {
                const shouldUpdate = await confirm(`Update available: ${update.version}. Install?`, {
                    title: CONFIG.APP_NAME,
                    kind: 'info'
                });
                (await Window.getByLabel('main'))?.hide();

                if (shouldUpdate) {
                    console.log('Installing update');
                    await update.downloadAndInstall();
                    await relaunch();
                }
            } else if (shouldNotify) {
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
                await NotificationService.notify(CONFIG.APP_NAME, 'Error checking for updates');
            }
        }
    }
} 