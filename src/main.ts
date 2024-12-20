import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu } from '@tauri-apps/api/menu';
import { load } from '@tauri-apps/plugin-store';
import { Window } from '@tauri-apps/api/window';
import OpenAI from 'openai';
import { exit } from '@tauri-apps/plugin-process';
import { message, confirm, ask } from '@tauri-apps/plugin-dialog';
import { info } from '@tauri-apps/plugin-log';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { registerActionTypes } from '@tauri-apps/plugin-notification';
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
import { Webview } from '@tauri-apps/api/webview';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { enable, isEnabled, disable } from '@tauri-apps/plugin-autostart';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

let openai: OpenAI;
let permissionGranted = false;
let unlistenTextUpdate: UnlistenFn;
let unlistenClipboard: () => Promise<void>;
let monitorRunning = false;
let autoUpdateDialogOpen = false;

let store: Awaited<ReturnType<typeof load>>;

async function initializeOpenAI() {
  const llmType = await store.get('llm_type') as string;
  if (llmType === 'openai') {
    console.log('initializeOpenAI');

    const openai_api_key: string = await store.get('openai_api_key') as string;

    try {
      openai = new OpenAI({
        apiKey: openai_api_key,
        dangerouslyAllowBrowser: true
      });
      console.log('OpenAI client initialized successfully');
    } catch (error) {
      console.error('Error initializing OpenAI:', error);
    }
  }
}


async function checkForAppUpdates() {
  try {
    const update = await check();
    if (update) {
      if (permissionGranted) {
        sendNotification({ title: 'pasteAI', body: 'Update available, go to "About" in taskbar to update' });
      }
    }
  } catch (error) {
    if (permissionGranted) {
      sendNotification({ title: 'pasteAI', body: 'Error checking for updates' });
    }
  }
}


async function openSettingsWindow() {
  const newWindow = new WebviewWindow('settings', {
    url: '/settings.html',
    title: 'Settings',
    width: 550,
    height: 800,
    resizable: false,
    alwaysOnTop: true,
  });
  newWindow.once('tauri://created', () => {
    console.log('New window created');
  });

  newWindow.once('tauri://error', (error) => {
    console.error('Failed to create window:', error);
  });

}

async function openAboutWindow() {
  const newWindow = new WebviewWindow('about', {
    url: '/about.html',
    title: 'About pasteAI',
    width: 400,
    height: 650,
    resizable: false,
    alwaysOnTop: true,
  });
}

async function initializeTray() {
  console.log("Initializing tray");
  const isAutoStartEnabled = await isEnabled();
  const menu = await Menu.new({
    items: [
      {
        id: 'about',
        text: '❓ About',
        action: () => {
          openAboutWindow();
        },
      },
      {
        id: 'settings',
        text: '🔑 Settings',
        action: () => {
          openSettingsWindow();
        },
      },
      {
        id: 'debug',
        text: '🐛 Show debug window',
        action: () => {
          Window.getCurrent().show();
        },
      },
      {
        id: 'autostart',
        text: isAutoStartEnabled ? '🚫 Disable Autostart' : '✅ Enable Autostart',
        action: async () => {
          if (await isEnabled()) {
            await disable();
            (await menu.get('autostart'))?.setText('✅ Enable Autostart');
          } else {
            await enable();
            (await menu.get('autostart'))?.setText('🚫 Disable Autostart');
          }
        },
      },
      {
        id: 'quit',
        text: '🚪 Quit',
        action: () => {
          exit(0);
        },
      },
    ],
  });

  const options = {
    tooltip: 'pasteAI',
    menu,
    menuOnLeftClick: true,
    icon: await defaultWindowIcon() ?? ''
    //,
    //iconAsTemplate: true
  };

  await TrayIcon.new(options);
}



async function improveSentence(msg: string): Promise<string> {
  const llmType = await store.get('llm_type') as string || 'openai';

  const systemPrompt = await invoke("get_system_prompt_from_settings") as string;
  if (llmType === 'ollama') {
    console.log("ollama improve sentence");
    const ollamaUrl = await store.get('ollama_url') as string;
    const ollama_model = await store.get('ollama_model') as string;

    /*console.log("ollama: " + JSON.stringify({
      model: ollama_model,
      prompt: systemPrompt + "\n" + msg,
      stream: false
    }));*/

    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ollama_model,
        system: systemPrompt,
        prompt: msg,
        stream: false
      }),
    });

    const data = await response.json();
    //console.log("ollama response: " + JSON.stringify(data));

    return data.response || msg;
    //return msg;
  } else {

    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: msg
        }
      ],
      model: "gpt-4o-mini",
    });

    return completion.choices[0].message.content || msg;
  }
}


let clipboardContent = "";
let lastUpdateTime = 0;
let lastImprovedContent = "";
let lastNotImprovedContent = "";

let copyedSameTextXTimes = 0;

async function monitorClipboard() {
  unlistenTextUpdate = await onTextUpdate(async (newText) => {
    const currentTime = Date.now();
    console.log("--------------------------------");
    console.log("- newText (" + copyedSameTextXTimes + "x) " + (currentTime - lastUpdateTime) + "ms");
    console.log("- lastNotImprovedContent: " + lastNotImprovedContent);
    console.log("- clipboardContent: " + clipboardContent);
    console.log("- newText: " + newText);
    console.log("- lastImprovedContent: " + lastImprovedContent);
    console.log("--------------------------------");

    if (newText === lastNotImprovedContent && newText != lastImprovedContent) {
      console.log("newText === lastNotImprovedContent do nothing but write lastImprovedContent to clipboard");
      await clipboard.writeText(lastImprovedContent);
      return;
    }

    if (newText === clipboardContent && (currentTime - lastUpdateTime) < 800 && (currentTime - lastUpdateTime) > 100) {
      copyedSameTextXTimes++;
      console.log("copyedSameTextXTimes++");
    } else {
      copyedSameTextXTimes = 1;
    }

    lastUpdateTime = currentTime;
    clipboardContent = newText;

    if (copyedSameTextXTimes >= 2 && newText != lastNotImprovedContent) {
      console.log("copied the same text " + copyedSameTextXTimes + " times");

      lastNotImprovedContent = newText;

      try {
        if (permissionGranted) {
          sendNotification({ title: 'pasteAI', body: 'Starting to improve sentence' });
        }

        console.log("starting to improve sentence");
        lastImprovedContent = await improveSentence(newText);
        await clipboard.writeText(lastImprovedContent);
        console.log("done to improve sentence");

        if (permissionGranted) {
          sendNotification({ title: 'pasteAI', body: 'Improved sentence ready' });
        } else {
          console.log("no permission granted for notification");
        }
        console.log("improvedContent: ------------------------------>" + lastImprovedContent);
      } catch (error) {
        console.error("Error improving sentence:", error);
        if (permissionGranted) {
          sendNotification({ title: 'pasteAI', body: 'Could not improve sentence, please check your settings' });
        }
      }



    }


  });

  unlistenClipboard = await startListening();
}

listenToMonitorStatusUpdate((running) => {
  monitorRunning = running;
});

/*onDestroy(() => {
  if (unlistenTextUpdate) unlistenTextUpdate();
  if (unlistenImageUpdate) unlistenImageUpdate();
  if (unlistenHtmlUpdate) unlistenHtmlUpdate();
  if (unlistenFiles) unlistenFiles();
  if (unlistenClipboard) unlistenClipboard();
});
*/


async function main() {
  info("Main function called");
  // Do you have permission to send a notification?
  store = await load('store.json', { autoSave: false });
  permissionGranted = await isPermissionGranted();

  // If not we need to request it
  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === 'granted';
  }
  await listen<{ loggedIn: boolean, token: string }>('settings-saved', async (event) => {
    console.log('Settings saved:', event.payload);
    await initializeOpenAI();
  });

  await listen<{ loggedIn: boolean, token: string }>('open-settings-window', async (event) => {
    console.log('Settings saved:', event.payload);
    await openSettingsWindow();
  });


  await initializeTray();
  await initializeOpenAI();
  await monitorClipboard();

  if ((await store.get('show_start')) != false) {
    await openStartWindow();
  }

  await checkForAppUpdates();
}


async function openStartWindow() {
  const newWindow = new WebviewWindow('start', {
    url: '/start.html',
    title: 'pasteAI',
    width: 700,
    height: 900,
    resizable: false,
    alwaysOnTop: true,
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  // Get current window label
  const label = Window.getCurrent().label;

  // Only run initialization for main window
  if (label === 'main') {
    //message('Hello World', { title: 'pasteAI', kind: 'error' });
    main().catch(error => {
      console.error('Error during initialization:', {
        message: error?.message,
        stack: error?.stack,
        fullError: error
      });
      message(`Failed to initialize application: ${error?.message || 'Unknown error'}\n${error?.stack || ''}`,
        { title: 'pasteAI', kind: 'error' });
    });
  }
});
