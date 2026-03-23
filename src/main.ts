import { Window } from '@tauri-apps/api/window';
import { message } from '@tauri-apps/plugin-dialog';
import { CONFIG } from './config';
import { createAppRuntime } from './app/runtime';

const runtime = createAppRuntime();

// Application entry point
window.addEventListener('DOMContentLoaded', async () => {
  const label = Window.getCurrent().label;

  if (label === 'main') {
    try {
      await runtime.start();
    } catch (error) {
      const appError = error as Error;
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
