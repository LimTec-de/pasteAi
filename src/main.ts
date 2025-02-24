import { Window } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { listen } from '@tauri-apps/api/event';
import { CONFIG } from './config';
import { AppError } from './app-types';
import { Services } from './services';
import { invoke } from '@tauri-apps/api/core';
import {
  LLMService,
  WindowManager,
  TrayManager,
  ClipboardMonitor,
  UpdateManager
} from './services';
import { PromptStore } from './services/prompt-store';
import { SettingsStore } from './services/settings-store';

// Services container
const services: Services = {};

// Application initialization
async function initializeApp() {
  // Initialize SettingsStore
  await SettingsStore.initialize();

  // Initialize PromptStore
  await PromptStore.initialize();

  // Get system unique ID
  // Initialize app ID
  // Try to get existing app ID from store, or generate a new one if not found
  services.appId = await SettingsStore.get<string>('appId');
  if (!services.appId) {
    services.appId = crypto.randomUUID();
    await SettingsStore.set('appId', services.appId);
    await SettingsStore.save();
  }

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
  const showStart = await SettingsStore.get<boolean>('show_start');
  if (showStart !== false) {
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
