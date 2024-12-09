import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu } from '@tauri-apps/api/menu';
import { load } from '@tauri-apps/plugin-store';
import { Window } from '@tauri-apps/api/window';
import OpenAI from 'openai';
import { exit } from '@tauri-apps/plugin-process';
import { message } from '@tauri-apps/plugin-dialog';
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


info("Starting pasteAi");

let openai: OpenAI;
let permissionGranted = false;
let unlistenTextUpdate: UnlistenFn;
let unlistenClipboard: () => Promise<void>;
let monitorRunning = false;

async function initializeOpenAI() {
  console.log('initializeOpenAI');

  const store = await load('store.json', { autoSave: false });
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

async function openApiKeyWindow() {
  const newWindow = new WebviewWindow('api-key', {
    url: '/apikey.html',
    title: 'Settings',
    width: 450,
    height: 270,
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

async function initializeTray() {
  console.log("Initializing tray");
  const menu = await Menu.new({
    items: [
      {
        id: 'openai-key',
        text: 'OpenAI Key',
        action: () => {
          openApiKeyWindow();
        },
      },
      {
        id: 'quit',
        text: 'Quit',
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
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a grammar and language corrector, you will write better sentences. You will not change the language of the sentence, only make it better. You do not answer any questions."
        },
        {
          role: "user",
          content: msg
        }
      ],
      model: "gpt-4o-mini",
    });

    return completion.choices[0].message.content || msg;
  } catch (error) {
    return "Could not improve sentence.";
  }
}


let clipboardContent = "";
let lastUpdateTime = 0;
let lastImprovedContent = "";

async function monitorClipboard() {
  unlistenTextUpdate = await onTextUpdate(async (newText) => {
    const currentTime = Date.now();
    console.log("newText: " + newText + " - " + (currentTime - lastUpdateTime));

    if (lastImprovedContent !== newText && newText === clipboardContent && currentTime - lastUpdateTime < 2000) {
      console.log("copied the same");

      lastImprovedContent = await improveSentence(newText);
      await clipboard.writeText(lastImprovedContent);

      if (permissionGranted) {
        sendNotification({ title: 'pasteAi', body: 'Improved sentence ready' });
      }

      console.log("improvedContent: " + lastImprovedContent);

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
  permissionGranted = await isPermissionGranted();

  // If not we need to request it
  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === 'granted';
  }

  await initializeTray();
  await initializeOpenAI();
  await monitorClipboard();

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
