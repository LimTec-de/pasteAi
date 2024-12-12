import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu } from '@tauri-apps/api/menu';
import { load } from '@tauri-apps/plugin-store';
import { Window } from '@tauri-apps/api/window';
import OpenAI from 'openai';
import { exit } from '@tauri-apps/plugin-process';
import { message, confirm } from '@tauri-apps/plugin-dialog';
import { info } from '@tauri-apps/plugin-log';
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

async function checkForUpdatesTimer() {
  if (!autoUpdateDialogOpen) {
    const update = await check();
    if (update) {
      autoUpdateDialogOpen = true;
      const confirmation = await confirm(
        'Found update, do you want to install it?',
        { title: 'pasteAi', kind: 'info' }
      );
      autoUpdateDialogOpen = false;
      if (confirmation) {
        await checkForUpdates();
      }
    }
  } else {
    console.log("autoUpdateDialogOpen is true, not checking for updates");
  }
}

async function checkForUpdates() {
  const update = await check();
  if (update) {
    console.log(
      `found update ${update.version} from ${update.date} with notes ${update.body}`
    );
    let downloaded = 0;
    let contentLength = 0;
    // alternatively we could also call update.download() and update.install() separately
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength ?? 0;
          if (permissionGranted) {
            sendNotification({ title: 'pasteAi', body: 'Started downloading' });
          }
          console.log(`started downloading `);
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          console.log(`downloaded ${downloaded} from ${contentLength}`);
          break;
        case 'Finished':
          if (permissionGranted) {
            sendNotification({ title: 'pasteAi', body: 'Download finished' });
          }
          console.log('download finished');
          break;
      }
    });

    console.log('update installed');
    if (permissionGranted) {
      sendNotification({ title: 'pasteAi', body: 'Update installed, restarting' });
    }
    await relaunch();
  } else {
    console.log('no update found');
    if (permissionGranted) {
      sendNotification({ title: 'pasteAi', body: 'no update found' });
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
    title: 'About pasteAi',
    width: 350,
    height: 330,
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
        id: 'openai-key',
        text: '🔑 Settings',
        action: () => {
          openSettingsWindow();
        },
      },
      {
        id: 'check-for-updates',
        text: '🔄 Check and install updates',
        action: () => {
          checkForUpdates();
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
        id: 'debug',
        text: '🐛 Show debug window',
        action: () => {
          Window.getCurrent().show();
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
    tooltip: 'pasteAi',
    menu,
    menuOnLeftClick: true,
    icon: await defaultWindowIcon() ?? '',
  };

  await TrayIcon.new(options);
}



async function improveSentence(msg: string): Promise<string> {
  const llmType = await store.get('llm_type') as string;
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

    //"This is a test. Hello ho ar you!=?"

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

async function monitorClipboard() {
  unlistenTextUpdate = await onTextUpdate(async (newText) => {
    const currentTime = Date.now();
    console.log("newText: " + newText + " - " + (currentTime - lastUpdateTime));

    if (lastImprovedContent !== newText && newText === clipboardContent && (currentTime - lastUpdateTime) < 2000 && (currentTime - lastUpdateTime) > 200) {
      console.log("copied the same");

      if (lastNotImprovedContent == newText) {
        console.log("same text, not improving setting to last improved");
        await clipboard.writeText(lastImprovedContent);
        return;
      } else {

        lastNotImprovedContent = newText;

        try {
          if (permissionGranted) {
            sendNotification({ title: 'pasteAi', body: 'Starting to improve sentence' });
          }

          lastImprovedContent = await improveSentence(newText);
          await clipboard.writeText(lastImprovedContent);

          if (permissionGranted) {
            sendNotification({ title: 'pasteAi', body: 'Improved sentence ready' });
          } else {
            console.log("no permission granted for notification");
          }
          console.log("improvedContent: " + lastImprovedContent);
        } catch (error) {
          console.error("Error improving sentence:", error);
          if (permissionGranted) {
            sendNotification({ title: 'pasteAi', body: 'Could not improve sentence, please check your settings' });
          }
        }


      }

    }

    clipboardContent = newText;
    lastUpdateTime = currentTime;
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


  setInterval(checkForUpdatesTimer, 1000 * 60 * 60 * 1);
}


async function openStartWindow() {
  const newWindow = new WebviewWindow('start', {
    url: '/start.html',
    title: 'pasteAi',
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
    //message('Hello World', { title: 'pasteAi', kind: 'error' });
    main().catch(error => {
      console.error('Error during initialization:', {
        message: error?.message,
        stack: error?.stack,
        fullError: error
      });
      message(`Failed to initialize application: ${error?.message || 'Unknown error'}\n${error?.stack || ''}`,
        { title: 'pasteAi', kind: 'error' });
    });
  }
});
