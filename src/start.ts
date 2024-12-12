import { load } from '@tauri-apps/plugin-store';
import { Window } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';

async function initializeUI() {
    const closeWindow = document.getElementById('closeWindow') as HTMLButtonElement;
    const openSettings = document.getElementById('openSettings') as HTMLButtonElement;

    closeWindow.addEventListener('click', async () => {

        if ((document.getElementById('doNotShowAgain') as HTMLInputElement)?.checked) {
            const store = await load('store.json', { autoSave: false });
            await store.set('show_start', false);
            await store.save();
        }

        await (await Window.getByLabel('start'))?.close();
    });

    openSettings.addEventListener('click', async () => {
        await emit('open-settings-window', {});
    });


}
window.addEventListener("DOMContentLoaded", async () => {
    await initializeUI();
});
