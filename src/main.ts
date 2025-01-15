import { Window } from '@tauri-apps/api/window';
import { load } from '@tauri-apps/plugin-store';
import { message } from '@tauri-apps/plugin-dialog';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { listen } from '@tauri-apps/api/event';
import { CONFIG } from './config';
import { AppError, Services } from './types';
import { invoke } from '@tauri-apps/api/core';
import {
  LLMService,
  WindowManager,
  TrayManager,
  ClipboardMonitor,
  UpdateManager
} from './services';

// Services container
const services: Services = {};

// Application initialization
async function initializeApp() {
  services.store = await load('pastai.json', { autoSave: false });

  // Get system unique ID
  services.appId = await invoke('get_unique_id') as string;

  // Initialize notifications
  const permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    const permission = await requestPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission not granted');
    }
  }

  // Set up event listeners
  await listen<{ loggedIn: boolean, token: string }>('settings-saved', async () => {
    await LLMService.initialize(services);
  });

  await listen<{ loggedIn: boolean, token: string }>('open-settings-window', async () => {
    await WindowManager.openSettings();
  });

  // Initialize core services
  await TrayManager.initialize();
  await LLMService.initialize(services);
  await ClipboardMonitor.initialize(services);

  // Show start window if needed
  if ((await services.store.get('show_start')) !== false) {
    await WindowManager.openStart();
  }

  // Check for updates
  await UpdateManager.checkUpdate(false);
}

// Application entry point
window.addEventListener("DOMContentLoaded", async () => {
  const label = Window.getCurrent().label;

  if (label === 'main') {
    try {
      await initializeApp();
    } catch (error) {
      const appError = error as AppError;
      console.error('Error during initialization:', {
        message: appError.message || 'Unknown error',
        stack: appError.stack,
        fullError: error
      });

      await message(
        `Failed to initialize application: ${appError.message || 'Unknown error'}\n${appError.stack || ''}`,
        { title: CONFIG.APP_NAME, kind: 'error' }
      );
    }
  }
});
