import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { load } from '@tauri-apps/plugin-store';
import { Window } from '@tauri-apps/api/window';
import OpenAI from 'openai';
import { exit, relaunch } from '@tauri-apps/plugin-process';
import { message, confirm } from '@tauri-apps/plugin-dialog';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import {
  onTextUpdate,
  startListening,
  listenToMonitorStatusUpdate,
} from "tauri-plugin-clipboard-api";
import clipboard from "tauri-plugin-clipboard-api";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { check } from '@tauri-apps/plugin-updater';
import { enable, isEnabled, disable } from '@tauri-apps/plugin-autostart';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { fetch } from '@tauri-apps/plugin-http';
import { LogicalSize } from '@tauri-apps/api/window';

// Types and Interfaces
interface AppConfig {
  MAX_TEXT_LENGTH: number;
  COPY_DETECTION_INTERVAL: number;
  COPY_DETECTION_INTERVAL_MAX: number;
  COPY_THRESHOLD: number;
  APP_NAME: string;
}

interface AppState {
  clipboardContent: string;
  lastUpdateTime: number;
  lastImprovedContent: string;
  lastNotImprovedContent: string;
  copyCount: number;
  monitorRunning: boolean;
  permissionGranted: boolean;
  autoUpdateDialogOpen: boolean;
  appId: string;
  isOldCopy: boolean;
}

interface WindowConfig {
  settings: {
    width: number;
    height: number;
    title: string;
  };
  about: {
    width: number;
    height: number;
    title: string;
  };
  start: {
    width: number;
    height: number;
    title: string;
  };
  status: {
    width: number;
    height: number;
    title: string;
  };
}

// Error type definition
interface AppError extends Error {
  stack?: string;
  message: string;
}

// Configuration
const CONFIG: AppConfig = {
  MAX_TEXT_LENGTH: 300,
  COPY_DETECTION_INTERVAL: 100,
  COPY_DETECTION_INTERVAL_MAX: 3000,
  COPY_THRESHOLD: 3,
  APP_NAME: 'pasteAI'
};

const WINDOW_CONFIG: WindowConfig = {
  settings: {
    width: 550,
    height: 800,
    title: 'Settings'
  },
  about: {
    width: 400,
    height: 650,
    title: 'About pasteAI'
  },
  start: {
    width: 700,
    height: 900,
    title: CONFIG.APP_NAME
  },
  status: {
    width: 300,
    height: 50,
    title: 'Status'
  }
};

// State management
let openai: OpenAI;
let store: Awaited<ReturnType<typeof load>>;
let unlistenTextUpdate: UnlistenFn;
let unlistenClipboard: () => Promise<void>;

const state: AppState = {
  clipboardContent: "",
  lastUpdateTime: 0,
  lastImprovedContent: "",
  lastNotImprovedContent: "",
  copyCount: 0,
  monitorRunning: false,
  permissionGranted: false,
  autoUpdateDialogOpen: false,
  appId: "",
  isOldCopy: true
};

// Notification utilities
const notify = async (title: string, body: string) => {
  if (state.permissionGranted) {
    await sendNotification({ title, body });
  }
  console.log(`${title}: ${body}`);
};

// Window management
class WindowManager {
  static async createWindow(type: keyof WindowConfig, url: string) {
    const config = WINDOW_CONFIG[type];
    const newWindow = new WebviewWindow(type, {
      url: `/${url}.html`,
      title: config.title,
      width: config.width,
      height: config.height,
      resizable: false,
      alwaysOnTop: true,
    });

    newWindow.once('tauri://created', () => {
      console.log(`${type} window created`);
    });

    newWindow.once('tauri://error', (error) => {
      console.error(`Failed to create ${type} window:`, error);
    });

    return newWindow;
  }

  static async openSettings() {
    return this.createWindow('settings', 'settings');
  }

  static async openAbout() {
    return this.createWindow('about', 'about');
  }

  static async openStart() {
    return this.createWindow('start', 'start');
  }
}

// LLM Service
class LLMService {
  static async initialize() {
    const llmType = await store.get('llm_type') as string;
    if (llmType === 'openai') {
      const apiKey = await store.get('openai_api_key') as string;
      try {
        openai = new OpenAI({
          apiKey,
          dangerouslyAllowBrowser: true
        });
        console.log('OpenAI client initialized successfully');
      } catch (error) {
        console.error('Error initializing OpenAI:', error);
      }
    }
  }

  static async improveSentence(text: string): Promise<string> {
    const llmType = await store.get('llm_type') as string || 'openai';
    const systemPrompt = await invoke("get_system_prompt_from_settings") as string;

    try {
      switch (llmType) {
        case 'ollama':
          return await this.improveWithOllama(text, systemPrompt);
        case 'openai':
          return await this.improveWithOpenAI(text, systemPrompt);
        default:
          return await this.improveWithPasteAI(text, systemPrompt);
      }
    } catch (error) {
      console.error(`Error improving text with ${llmType}:`, error);
      throw error;
    }
  }

  private static async improveWithOllama(text: string, systemPrompt: string): Promise<string> {
    const ollamaUrl = await store.get('ollama_url') as string;
    const ollamaModel = await store.get('ollama_model') as string;

    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        system: systemPrompt,
        prompt: text,
        stream: false
      }),
    });

    const data = await response.json();
    return data.response || text;
  }

  private static async improveWithOpenAI(text: string, systemPrompt: string): Promise<string> {
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text }
      ],
      model: "gpt-4o-mini",
    });

    return completion.choices[0].message.content || text;
  }

  private static async improveWithPasteAI(text: string, systemPrompt: string): Promise<string> {
    const formData = new FormData();
    formData.append('prompt', systemPrompt);
    formData.append('text', text);

    const response = await fetch(`https://api.pasteai.app/improve/${state.appId}`, {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (data.status === 'ok') {
      if (data.data.balance < 3) {
        await notify(CONFIG.APP_NAME, 'Almost out of balance, please recharge via https://pasteai.app');
      }
      return data.data.response || text;
    }

    throw new Error(data.data.message || 'An error occurred');
  }
}

// Clipboard monitoring
class ClipboardMonitor {
  static async initialize() {
    unlistenTextUpdate = await onTextUpdate(async (newText) => {
      const currentTime = Date.now();
      const lastCopy = currentTime - state.lastUpdateTime;

      state.isOldCopy = currentTime - state.lastUpdateTime > CONFIG.COPY_DETECTION_INTERVAL_MAX;
      if (currentTime > state.lastUpdateTime) {
        state.lastUpdateTime = currentTime;
      }

      if (lastCopy < CONFIG.COPY_DETECTION_INTERVAL) {
        console.log('Copy to fast! ' + (lastCopy));
      } else {
        console.log('Copy ' + (lastCopy));
        await this.handleTextUpdate(newText);
      }
    });

    unlistenClipboard = await startListening();
  }

  private static async handleTextUpdate(newText: string) {

    if (this.shouldSkipImprovement(newText)) {
      await this.handleSkippedImprovement();
      return;
    }

    await this.updateClipboardState(newText);

    if (this.shouldImproveText(newText)) {
      if (newText.length > CONFIG.MAX_TEXT_LENGTH) {
        await notify(CONFIG.APP_NAME, `Text too long (>${CONFIG.MAX_TEXT_LENGTH} chars), skipping improvement`);
        return;
      } else {
        await this.improveAndUpdateClipboard(newText);
      }
    } else {
      console.log(`Skipping improvement`);
      console.log(`----------------------------------------------------------------------`);
    }
  }

  private static shouldSkipImprovement(newText: string): boolean {
    return newText === state.lastNotImprovedContent && newText !== state.lastImprovedContent;
  }

  private static async handleSkippedImprovement() {
    if (state.lastImprovedContent) {
      await clipboard.writeText(state.lastImprovedContent);
    }
  }

  private static async updateClipboardState(newText: string) {

    if (newText === state.clipboardContent) {

      if (state.isOldCopy) {
        console.log(`Old copy detected`);
        state.copyCount = 1;
      } else {
        state.copyCount++;
        console.log('copyCount++')
      }

    } else {
      state.copyCount = 1;
    }

    console.log(`Copy count = ${state.copyCount}, isOldCopy = ${state.isOldCopy}`);

    state.clipboardContent = newText;
  }

  private static shouldImproveText(newText: string): boolean {
    return state.copyCount >= CONFIG.COPY_THRESHOLD && newText !== state.lastNotImprovedContent;
  }

  private static async improveAndUpdateClipboard(newText: string) {
    state.lastNotImprovedContent = newText;

    try {
      await StatusWindow.display('Starting to improve sentence');

      state.lastImprovedContent = await LLMService.improveSentence(newText);
      await clipboard.writeText(state.lastImprovedContent);

      await StatusWindow.display('Improved sentence ready');
    } catch (error) {
      console.error("Error improving sentence:", error);
      await notify(CONFIG.APP_NAME, `Could not improve sentence, please check your settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Tray management
class TrayManager {
  private static currentMenu: Menu | null = null;

  static async initialize() {
    const isAutoStartEnabled = await isEnabled();
    this.currentMenu = await this.createMenu(isAutoStartEnabled);

    const options = {
      tooltip: CONFIG.APP_NAME,
      menu: this.currentMenu,
      menuOnLeftClick: true,
      icon: await defaultWindowIcon() ?? '',
      action: (event: any) => {
        switch (event.type) {
          case 'Click':
            console.log(
              `mouse ${event.button} button pressed, state: ${event.buttonState}`
            );
            StatusWindow.display('Starting to improve sentence');
            break;
          case 'DoubleClick':
            console.log(`mouse ${event.button} button pressed`);
            break;
          case 'Enter':
            console.log(
              `mouse hovered tray at ${event.rect.position.x}, ${event.rect.position.y}`
            );
            break;
          case 'Move':
            console.log(
              `mouse moved on tray at ${event.rect.position.x}, ${event.rect.position.y}`
            );
            break;
          case 'Leave':
            console.log(
              `mouse left tray at ${event.rect.position.x}, ${event.rect.position.y}`
            );
            break;
        }
      }
    };

    await TrayIcon.new(options);
  }

  private static async createMenu(isAutoStartEnabled: boolean) {
    return await Menu.new({
      items: [
        {
          id: 'autostart',
          text: 'Start with system',
          checked: isAutoStartEnabled,
          action: async () => {
            await this.toggleAutostart();
          },
        },
        await PredefinedMenuItem.new({ item: 'Separator' }),
        {
          id: 'checkUpdates',
          text: 'Check for Updates...',
          action: async () => {
            await UpdateManager.checkUpdate(true);
          }
        },
        {
          id: 'settings',
          text: 'Settings',
          action: () => WindowManager.openSettings(),
        },
        {
          id: 'about',
          text: 'About',
          action: () => WindowManager.openAbout(),
        },
        await PredefinedMenuItem.new({ item: 'Separator' }),
        {
          id: 'debug',
          text: 'Show debug window',
          action: () => Window.getCurrent().show(),
        },
        await PredefinedMenuItem.new({ item: 'Separator' }),
        {
          id: 'quit',
          text: 'Quit',
          action: () => exit(0),
        },
      ],
    });
  }

  private static async toggleAutostart() {
    if (!this.currentMenu) return;

    const isAutoStartEnabled = await this.isAutoStartEnabled();

    if (isAutoStartEnabled) {
      await disable();
      const menuItem = await this.currentMenu.get('autostart');
      if (menuItem) await menuItem.setText('Enable Autostart');
    } else {
      await enable();
      const menuItem = await this.currentMenu.get('autostart');
      if (menuItem) await menuItem.setText('Disable Autostart');
    }
  }

  private static async isAutoStartEnabled(): Promise<boolean> {
    return await isEnabled();
  }
}

// Update checker
class UpdateManager {
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
        await notify(CONFIG.APP_NAME, 'Error checking for updates');
      }
    }
  }
}

// Status Window Manager
class StatusWindow {
  private static hideTimeout: number | null = null;

  static async display(message: string) {
    const mainWindow = Window.getCurrent();
    if (!mainWindow) return;

    // Show window and update message
    await mainWindow.show();

    // Update the message directly
    const statusElement = document.getElementById('status-message');
    if (!statusElement) return;

    // Update content
    statusElement.textContent = message;
    statusElement.style.display = 'block';

    // Give the browser a moment to calculate the new size
    await new Promise(resolve => setTimeout(resolve, 50));

    // Get the actual size of the status message
    const rect = statusElement.getBoundingClientRect();
    const padding = 40; // Extra padding for the window

    // Update window size to fit content using LogicalSize
    const newSize = new LogicalSize(
      Math.min(Math.max(rect.width + padding, 300), 800),
      Math.min(rect.height + padding, 400)
    );
    await mainWindow.setSize(newSize);

    // Reset the auto-hide timer
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }

    this.hideTimeout = setTimeout(async () => {
      const element = document.getElementById('status-message');
      if (element) {
        element.style.display = 'none';
      }
      await mainWindow.hide();
    }, 2000);
  }
}

// Application initialization
async function initializeApp() {
  store = await load('pastai.json', { autoSave: false });

  // Initialize app ID
  state.appId = await store.get('appId') as string;
  if (!state.appId) {
    state.appId = crypto.randomUUID();
    await store.set('appId', state.appId);
    await store.save();
  }

  // Initialize notifications
  state.permissionGranted = await isPermissionGranted();
  if (!state.permissionGranted) {
    const permission = await requestPermission();
    state.permissionGranted = permission === 'granted';
  }

  // Set up event listeners
  await listen<{ loggedIn: boolean, token: string }>('settings-saved', async () => {
    await LLMService.initialize();
  });

  await listen<{ loggedIn: boolean, token: string }>('open-settings-window', async () => {
    await WindowManager.openSettings();
  });

  // Initialize core services
  await TrayManager.initialize();
  await LLMService.initialize();
  await ClipboardMonitor.initialize();

  // Show start window if needed
  if ((await store.get('show_start')) !== false) {
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
