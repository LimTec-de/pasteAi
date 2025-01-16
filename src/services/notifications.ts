import { sendNotification } from '@tauri-apps/plugin-notification';

export class NotificationService {
    static async notify(title: string, body: string): Promise<void> {
        try {
            await sendNotification({ title, body });
        } catch (error) {
            console.error('Failed to send notification:', error);
        }
        console.log(`${title}: ${body}`);
    }
} 