import { sendNotification } from '@tauri-apps/plugin-notification';

export const notify = async (title: string, body: string) => {
    try {
        await sendNotification({ title, body });
    } catch (error) {
        console.error('Failed to send notification:', error);
    }
    console.log(`${title}: ${body}`);
}; 