import { PromptStore } from './services/prompt-store';
import { SettingsStore } from './services/settings-store';
import { Window } from '@tauri-apps/api/window';

async function initializePromptSelector(): Promise<void> {
    try {
        // Initialize SettingsStore in this window context
        // This is necessary because the prompt selector runs in a separate window
        // and doesn't share the initialization from main.ts
        await SettingsStore.initialize();

        const promptList = document.getElementById('prompt-list') as HTMLUListElement;
        const statusMessage = document.getElementById('status-message') as HTMLDivElement;
        const cancelButton = document.getElementById('cancel-button') as HTMLButtonElement;

        if (!promptList || !statusMessage || !cancelButton) {
            throw new Error('Required DOM elements not found');
        }

        // Set up cancel button functionality
        cancelButton.addEventListener('click', async () => {
            // Close the window when cancel is clicked
            await Window.getCurrent().close();
        });

        // Get all prompts from the store
        const prompts = await PromptStore.getAllPrompts();

        if (prompts.length === 0) {
            statusMessage.textContent = 'No prompts available.';
            statusMessage.classList.add('info');
            return;
        }

        // Create list items for each prompt
        prompts.forEach(prompt => {
            const listItem = document.createElement('li');
            listItem.classList.add('prompt-item');
            listItem.textContent = prompt.title;
            listItem.dataset.promptId = prompt.id.toString();

            // Add click handler to select the prompt
            listItem.addEventListener('click', async () => {
                // Emit an event to the main window with the selected prompt
                await Window.getCurrent().emit('prompt-selected', prompt);

                // The main window will close this window after receiving the event
            });

            promptList.appendChild(listItem);
        });

    } catch (error) {
        console.error('Failed to initialize prompt selector:', error);

        // Show error to user
        const errorDiv = document.createElement('div');
        errorDiv.style.color = 'red';
        errorDiv.style.padding = '20px';
        errorDiv.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
        document.body.prepend(errorDiv);
    }
}

// Initialize when DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
    initializePromptSelector();
}); 