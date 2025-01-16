import { Command } from '@tauri-apps/plugin-shell';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Window } from '@tauri-apps/api/window';
import { SettingsUIElements, LLMType } from './settings-ui';
import { SettingsUIManager } from './settings-ui';
import { SettingsAPIService } from './settings-api';
import { SettingsStore } from './settings-store';

export class SettingsManager {
    private ui: SettingsUIManager;
    private elements: SettingsUIElements;

    constructor(elements: SettingsUIElements) {
        this.elements = elements;
        this.ui = new SettingsUIManager(elements);
        this.initializeEventListeners();
    }

    private async initializeEventListeners(): Promise<void> {
        const { llmTypeSelect, ollamaUrl, installPhiButton, loginButton, saveButton } = this.elements;

        llmTypeSelect.addEventListener('change', () => this.handleLLMTypeChange());
        ollamaUrl.addEventListener('change', () => this.handleLLMTypeChange());
        installPhiButton.addEventListener('click', () => this.handlePhiInstall());
        loginButton.addEventListener('click', () => this.handleLogin());
        saveButton.addEventListener('click', () => this.handleSave());
    }

    private async handleLLMTypeChange(): Promise<void> {
        const { llmTypeSelect, ollamaUrl, ollamaStatus } = this.elements;

        await this.ui.updateVisibility(llmTypeSelect.value as LLMType);

        if (llmTypeSelect.value === 'ollama') {
            const isAvailable = await SettingsAPIService.checkOllamaAvailability(ollamaUrl.value);
            ollamaStatus.style.display = isAvailable ? 'none' : 'block';

            if (isAvailable) {
                const models = await SettingsAPIService.fetchOllamaModels(ollamaUrl.value);
                await this.ui.updateModelList(models);
            }
        } else if (llmTypeSelect.value === 'pasteai') {
            await this.handleCheckQuota();
        }
    }

    private async handlePhiInstall(): Promise<void> {
        const { installPhiButton } = this.elements;
        const outputPre = document.getElementById('installOutput') as HTMLPreElement;

        installPhiButton.disabled = true;
        outputPre.style.display = 'block';
        outputPre.textContent = 'Installing phi:mini...\n';

        try {
            const command = Command.create('ollama', ['pull', 'phi3:mini']);
            this.setupCommandListeners(command, outputPre, installPhiButton);
            await command.spawn();
        } catch (error) {
            outputPre.textContent += `\nError: ${error}`;
            installPhiButton.disabled = false;
        }
    }

    private setupCommandListeners(command: any, outputPre: HTMLPreElement, button: HTMLButtonElement): void {
        command.on('close', async ({ code }: { code: number }) => {
            outputPre.textContent += code === 0 ? '\nInstallation complete!' : `\nProcess exited with code ${code}`;
            button.disabled = false;
            if (code === 0) await this.handleLLMTypeChange();
        });

        command.on('error', (error: Error) => {
            outputPre.textContent += `\nError: ${error}`;
            button.disabled = false;
        });

        ['stdout', 'stderr'].forEach(stream => {
            command[stream].on('data', (line: string) => {
                outputPre.textContent += line + '\n';
                outputPre.scrollTop = outputPre.scrollHeight;
            });
        });
    }

    private async handleLogin(): Promise<void> {
        const { emailInput, loginButton, llmTypeSelect } = this.elements;
        const email = emailInput.value.trim();

        if (!email) {
            this.ui.updateLoginMessage('Please enter an email address', true);
            return;
        }

        loginButton.disabled = true;
        this.ui.updateLoginMessage('Sending verification email...', false);

        try {
            const appId = await SettingsStore.get<string>('appId');
            await SettingsStore.set('email', email);
            await SettingsStore.set('llm_type', llmTypeSelect.value);
            await SettingsStore.save();

            const response = await SettingsAPIService.loginUser(email, appId);
            this.ui.updateLoginMessage(
                response.status === 'ok'
                    ? response.data.message
                    : response.data.message || 'An error occurred',
                response.status !== 'ok'
            );
        } catch (error) {
            this.ui.updateLoginMessage('Failed to send verification email', true);
            console.error('Login error:', error);
        } finally {
            loginButton.disabled = false;
        }
    }

    private async handleSave(): Promise<void> {
        const { saveButton, llmTypeSelect, ollamaUrl, modelSelect, apiKeyInput, systemPromptInput } = this.elements;

        try {
            saveButton.disabled = true;

            // Save all settings
            await SettingsStore.set('llm_type', llmTypeSelect.value);
            await SettingsStore.set('ollama_url', ollamaUrl.value);
            await SettingsStore.set('ollama_model', modelSelect.value);
            await SettingsStore.set('openai_api_key', apiKeyInput.value);

            // Save system prompt
            await invoke('set_system_prompt_from_settings', { prompt: systemPromptInput.value });
            await SettingsStore.save();

            // Emit settings saved event
            await emit('settings-saved', { loggedIn: true, token: apiKeyInput.value });

            // Close the window
            await Window.getCurrent().close();
        } catch (error) {
            console.error('Error saving settings:', error);
            saveButton.disabled = false;
            // Show error to user
            const errorDiv = document.createElement('div');
            errorDiv.style.color = 'red';
            errorDiv.style.padding = '10px';
            errorDiv.textContent = `Error saving settings: ${error instanceof Error ? error.message : String(error)}`;
            saveButton.parentElement?.insertBefore(errorDiv, saveButton);
        }
    }

    private async handleCheckQuota(): Promise<void> {
        const { quotaDisplay, emailInput, loginButton, loginMessage } = this.elements;
        quotaDisplay.style.display = 'none'; // Reset display state

        try {
            const appId = await SettingsStore.get<string>('appId');
            if (!appId) {
                console.error('No appId found');
                quotaDisplay.textContent = 'Error: No app ID found';
                quotaDisplay.style.display = 'block';
                return;
            }

            const response = await SettingsAPIService.checkQuota(appId);
            console.log('Quota response:', response); // Add logging

            if (response.status === 'ok') {
                quotaDisplay.textContent = `Balance: ${response.data.balance}${response.data.email ? '' : ' free'} tokens`;
                quotaDisplay.style.display = 'block';

                // Update email-related UI
                if (response.data.email) {
                    // Hide email input container and login button
                    const emailContainer = emailInput.closest('div[style*="display: flex"]') as HTMLElement;
                    if (emailContainer) emailContainer.style.display = 'none';
                    const emailLabel = emailInput.closest('.input-group')?.querySelector('label') as HTMLElement;
                    if (emailLabel) emailLabel.style.display = 'none';
                    loginButton.style.display = 'none';
                    // Show login status
                    loginMessage.style.display = 'block';
                    loginMessage.style.color = '#008000';
                    loginMessage.textContent = `Logged in via ${response.data.email}`;
                } else {
                    // Show email input container and login button
                    const emailContainer = emailInput.closest('div[style*="display: flex"]') as HTMLElement;
                    if (emailContainer) emailContainer.style.display = 'flex';
                    const emailLabel = emailInput.closest('.input-group')?.querySelector('label') as HTMLElement;
                    if (emailLabel) emailLabel.style.display = 'block';
                    emailInput.disabled = false;
                    loginButton.style.display = 'block';
                    loginMessage.style.display = 'none';
                }
            } else {
                quotaDisplay.textContent = 'Error checking quota';
                quotaDisplay.style.display = 'block';
            }
        } catch (error) {
            console.error('Error checking quota:', error);
            quotaDisplay.textContent = 'Error checking quota';
            quotaDisplay.style.display = 'block';
        }
    }

    async loadExistingSettings(): Promise<void> {
        const { llmTypeSelect, ollamaUrl, apiKeyInput, systemPromptInput, emailInput } = this.elements;

        const llmType = await SettingsStore.get<string>('llm_type') || 'pasteai';
        llmTypeSelect.value = llmType;
        await this.ui.updateVisibility(llmType as LLMType);

        ollamaUrl.value = await SettingsStore.get<string>('ollama_url') || 'http://localhost:11434';
        apiKeyInput.value = await SettingsStore.get<string>('openai_api_key') || '';
        systemPromptInput.value = await invoke('get_system_prompt_from_settings') as string;
        emailInput.value = await SettingsStore.get<string>('email') || '';

        if (llmType === 'ollama') {
            const isAvailable = await SettingsAPIService.checkOllamaAvailability(ollamaUrl.value);
            this.elements.ollamaStatus.style.display = isAvailable ? 'none' : 'block';

            if (isAvailable) {
                const models = await SettingsAPIService.fetchOllamaModels(ollamaUrl.value);
                await this.ui.updateModelList(models);
            }
        } else if (llmType === 'pasteai') {
            await this.handleCheckQuota();
        }
    }
} 