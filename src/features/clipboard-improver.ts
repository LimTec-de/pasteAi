import clipboard, { onTextUpdate, startListening } from 'tauri-plugin-clipboard-api';
import { CONFIG } from '../config';
import { PromptRepository } from '../domain/prompt-repository';
import { ProviderGateway } from '../domain/provider-gateway';
import type { PromptOption, StatusType } from '../domain/types';
import { AppWindows } from '../platform/windows';

type ClipboardRunState = 'idle' | 'awaitingPrompt' | 'improving' | 'applyingResult' | 'cooldown';

interface ClipboardState {
    clipboardContent: string;
    lastUpdateTime: number;
    copyCount: number;
    isOldCopy: boolean;
    runState: ClipboardRunState;
    suppressedClipboardText: string | null;
    cooldownTimeout: number | null;
}

export class ClipboardImprover {
    private readonly state: ClipboardState = {
        clipboardContent: '',
        lastUpdateTime: 0,
        copyCount: 0,
        isOldCopy: true,
        runState: 'idle',
        suppressedClipboardText: null,
        cooldownTimeout: null
    };

    constructor(
        private readonly promptRepository: PromptRepository,
        private readonly providerGateway: ProviderGateway,
        private readonly windows: AppWindows
    ) { }

    async start(): Promise<void> {
        await onTextUpdate(async (text) => {
            await this.handleClipboardUpdate(text);
        });

        await startListening();
    }

    private async handleClipboardUpdate(newText: string): Promise<void> {
        if (this.isSuppressedClipboardWrite(newText)) {
            this.state.suppressedClipboardText = null;
            this.enterCooldown();
            return;
        }

        if (this.state.runState !== 'idle') {
            return;
        }

        const currentTime = Date.now();
        const lastCopyDelta = currentTime - this.state.lastUpdateTime;

        this.state.isOldCopy = lastCopyDelta > CONFIG.COPY_DETECTION_INTERVAL_MAX;
        this.state.lastUpdateTime = currentTime;

        if (lastCopyDelta < CONFIG.COPY_DETECTION_INTERVAL) {
            return;
        }

        const prefixMatch = this.matchTriggerPrefix(newText);
        if (prefixMatch) {
            await this.handlePrefixTrigger(prefixMatch.identifier, prefixMatch.body);
            return;
        }

        this.updateClipboardState(newText);

        if (!this.shouldImproveText(newText)) {
            return;
        }

        if (newText.length > CONFIG.MAX_TEXT_LENGTH) {
            await this.showStatus(`Text too long (> ${CONFIG.MAX_TEXT_LENGTH} chars), skipping improvement`, 'error');
            this.resetRunState();
            return;
        }

        await this.improveText(newText, null);
    }

    private matchTriggerPrefix(newText: string): { identifier: string | null; body: string } | null {
        if (!newText.toLowerCase().startsWith(CONFIG.TRIGGER_PREFIX)) {
            return null;
        }

        const afterPrefix = newText.slice(CONFIG.TRIGGER_PREFIX.length);
        const identifierMatch = afterPrefix.match(/^([a-z0-9-]+):/i);
        if (identifierMatch) {
            return {
                identifier: identifierMatch[1],
                body: afterPrefix.slice(identifierMatch[0].length).replace(/^\s+/, '')
            };
        }

        return { identifier: null, body: afterPrefix.replace(/^\s+/, '') };
    }

    private async handlePrefixTrigger(identifier: string | null, body: string): Promise<void> {
        if (body.trim().length === 0) {
            return;
        }

        if (body.length > CONFIG.MAX_TEXT_LENGTH) {
            await this.showStatus(`Text too long (> ${CONFIG.MAX_TEXT_LENGTH} chars), skipping improvement`, 'error');
            this.resetRunState();
            return;
        }

        const resolvedPrompt = identifier
            ? await this.promptRepository.getPromptByIdentifier(identifier)
            : null;

        if (resolvedPrompt) {
            await this.improveText(body, resolvedPrompt);
            return;
        }

        await this.improveText(identifier ? `${identifier}: ${body}` : body, null);
    }

    private updateClipboardState(newText: string): void {
        if (newText === this.state.clipboardContent) {
            this.state.copyCount = this.state.isOldCopy ? 1 : this.state.copyCount + 1;
        } else {
            this.state.copyCount = 1;
        }

        this.state.clipboardContent = newText;
    }

    private shouldImproveText(newText: string): boolean {
        return this.state.copyCount >= CONFIG.COPY_THRESHOLD && newText.trim().length > 0;
    }

    private async improveText(text: string, preselectedPrompt: PromptOption | null): Promise<void> {
        try {
            let selectedPrompt = preselectedPrompt ?? await this.promptRepository.getDefaultPrompt();
            if (!selectedPrompt) {
                this.state.runState = 'awaitingPrompt';
                selectedPrompt = await this.windows.choosePrompt();
            }

            if (!selectedPrompt) {
                this.resetRunState();
                return;
            }

            this.state.runState = 'improving';
            await this.showStatus('Improving sentence...', 'working', {
                autohide: false
            });

            const improvedText = await this.providerGateway.improve(text, selectedPrompt.prompt);
            await this.applyResult(selectedPrompt, improvedText);
        } catch (error) {
            console.error('Error improving sentence:', error);

            const providerError = error as Error & { data?: { type?: string } };
            if (providerError.data?.type === 'quota') {
                await this.showStatus(
                    'No tokens left! <a href="https://pasteai.app/tokens.html" target="_blank">Click here to recharge</a>',
                    'error',
                    { allowHtml: true }
                );
            } else {
                await this.showStatus(
                    `Could not improve sentence, please check your settings: ${error instanceof Error ? error.message : String(error)}`,
                    'error'
                );
            }

            this.resetRunState();
        }
    }

    private async applyResult(prompt: PromptOption, improvedText: string): Promise<void> {
        if (prompt.outputMode === 'window') {
            await this.windows.hideStatus();
            await this.windows.showAnswer(improvedText);
            this.resetRunState();
            return;
        }

        this.state.runState = 'applyingResult';
        this.state.suppressedClipboardText = improvedText;
        await clipboard.writeText(improvedText);
        await this.showStatus('Improved sentence ready', 'ok');
        this.enterCooldown();
    }

    private isSuppressedClipboardWrite(newText: string): boolean {
        return this.state.suppressedClipboardText !== null && newText === this.state.suppressedClipboardText;
    }

    private enterCooldown(): void {
        this.state.runState = 'cooldown';

        if (this.state.cooldownTimeout !== null) {
            window.clearTimeout(this.state.cooldownTimeout);
        }

        this.state.cooldownTimeout = window.setTimeout(() => {
            this.resetRunState();
        }, 250);
    }

    private resetRunState(): void {
        this.state.runState = 'idle';
        this.state.clipboardContent = '';
        this.state.copyCount = 0;
        this.state.isOldCopy = true;
        this.state.lastUpdateTime = 0;
        this.state.suppressedClipboardText = null;

        if (this.state.cooldownTimeout !== null) {
            window.clearTimeout(this.state.cooldownTimeout);
            this.state.cooldownTimeout = null;
        }
    }

    private async showStatus(message: string, type: StatusType, options: { autohide?: boolean; allowHtml?: boolean } = {}): Promise<void> {
        await this.windows.showStatus({
            message,
            type,
            autohide: options.autohide,
            allowHtml: options.allowHtml
        });
    }
}
