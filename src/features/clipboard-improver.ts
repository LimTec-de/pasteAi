import { emit, listen } from '@tauri-apps/api/event';
import clipboard, { getAvailableTypes, onTextUpdate, readHtml, startListening } from 'tauri-plugin-clipboard-api';
// Diagnostics logging (disabled). Re-add `readRtf` above and uncomment the import
// below together with logClipboardDiagnostics to re-enable raw clipboard logging.
// import { info } from '@tauri-apps/plugin-log';
import { APP_EVENTS, type StatusActionPayload } from '../app/events';
import { CONFIG } from '../config';
import { htmlToImprovableText } from '../domain/clipboard-html';
import {
    inspectCopiedDictation,
    isSpeakableTerm,
    normalizeReplacements,
    normalizeVocabulary
} from '../domain/dictate-dictionary';
import { PromptRepository } from '../domain/prompt-repository';
import { ProviderGateway } from '../domain/provider-gateway';
import { SettingsRepository } from '../domain/settings-repository';
import { isLocalLlmMissing } from '../domain/local-llm';
import type { DictionaryLearnPair, PromptOption, StatusType } from '../domain/types';
import { AppWindows } from '../platform/windows';

const LEARN_TIMEOUT_MS = 5 * 60 * 1000;

interface ImproveInput {
    text: string;
    html: string | null;
}

interface PendingImprove {
    input: ImproveInput;
    prompt: PromptOption;
    useHtml: boolean;
}

type ClipboardRunState = 'idle' | 'awaitingPrompt' | 'improving' | 'applyingResult' | 'cooldown' | 'dictating';

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
    private learn: { text: string; at: number } | null = null;
    private pendingLearn: DictionaryLearnPair[] | null = null;
    private pendingImprove: PendingImprove | null = null;
    private improveGeneration = 0;

    constructor(
        private readonly promptRepository: PromptRepository,
        private readonly providerGateway: ProviderGateway,
        private readonly windows: AppWindows,
        private readonly settingsRepository: SettingsRepository
    ) { }

    async start(): Promise<void> {
        await listen<StatusActionPayload>(APP_EVENTS.STATUS_ACTION, (event) => {
            void this.handleStatusAction(event.payload.action);
        });

        await onTextUpdate(async (text) => {
            await this.handleClipboardUpdate(text);
        });

        await startListening();
    }

    isBusy(): boolean {
        return this.state.runState !== 'idle' && this.state.runState !== 'cooldown';
    }

    beginDictation(): void {
        this.learn = null;
        this.pendingLearn = null;
        this.state.runState = 'dictating';
    }

    endDictation(): void {
        this.resetRunState();
    }

    suppressNextWrite(text: string): void {
        this.state.suppressedClipboardText = text;
    }

    armDictionaryLearn(text: string): void {
        this.learn = { text, at: Date.now() };
        this.pendingLearn = null;
    }

    enterWriteCooldown(): void {
        this.enterCooldown();
    }

    private async handleClipboardUpdate(newText: string): Promise<void> {
        // Diagnostics logging (disabled). Uncomment to inspect raw clipboard formats.
        // await this.logClipboardDiagnostics(newText);

        if (this.isSuppressedClipboardWrite(newText)) {
            this.state.suppressedClipboardText = null;
            this.enterCooldown();
            return;
        }

        if (this.state.runState !== 'idle') {
            return;
        }

        if (await this.maybeLearnFromCopy(newText)) {
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

        const html = await this.readClipboardHtmlIfAny();
        await this.improveText({ text: newText, html }, null);
    }

    private async readClipboardHtmlIfAny(): Promise<string | null> {
        try {
            const available = await getAvailableTypes();
            if (!available.html) {
                return null;
            }

            const html = await readHtml();
            return html.trim().length > 0 ? html : null;
        } catch (error) {
            console.warn('Could not read clipboard HTML:', error);
            return null;
        }
    }

    // Diagnostics logging (disabled). Uncomment this block plus the call in
    // handleClipboardUpdate and the `info`/`readRtf` imports to re-enable.
    // private async logClipboardDiagnostics(receivedText: string): Promise<void> {
    //     try {
    //         const lines = [
    //             `[clipboard] update received (runState=${this.state.runState}, ${receivedText.length} chars)`,
    //             `  text/plain: ${this.previewForLog(receivedText)}`
    //         ];
    //
    //         const available = await getAvailableTypes();
    //         lines.push(`  available formats: ${JSON.stringify(available)}`);
    //
    //         if (available.html) {
    //             lines.push(`  text/html: ${this.previewForLog(await readHtml())}`);
    //         }
    //
    //         if (available.rtf) {
    //             lines.push(`  text/rtf: ${this.previewForLog(await readRtf())}`);
    //         }
    //
    //         await info(lines.join('\n'));
    //     } catch (error) {
    //         console.warn('Could not log clipboard diagnostics:', error);
    //     }
    // }
    //
    // private previewForLog(value: string, maxLength = 4000): string {
    //     const preview = value.length > maxLength
    //         ? `${value.slice(0, maxLength)}… [truncated ${value.length - maxLength} chars]`
    //         : value;
    //     return JSON.stringify(preview);
    // }

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
            await this.improveText({ text: body, html: null }, resolvedPrompt);
            return;
        }

        await this.improveText({ text: identifier ? `${identifier}: ${body}` : body, html: null }, null);
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

    private async improveText(input: ImproveInput, preselectedPrompt: PromptOption | null): Promise<void> {
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

            this.pendingImprove = {
                input,
                prompt: selectedPrompt,
                useHtml: await this.shouldImproveAsHtml(input, selectedPrompt)
            };
            await this.runPendingImprove();
        } catch (error) {
            console.error('Error improving sentence:', error);
            this.pendingImprove = null;
            await this.showImproveError(error);
            this.resetRunState();
        }
    }

    private async runPendingImprove(refreshStatus = true): Promise<void> {
        const pending = this.pendingImprove;
        if (!pending) {
            return;
        }

        const generation = ++this.improveGeneration;
        this.state.runState = 'improving';
        if (refreshStatus) {
            await this.showStatus('Improving sentence...', 'working', {
                autohide: false,
                cancellable: true
            });
        }

        try {
            if (pending.useHtml && pending.input.html) {
                const improvedHtml = await this.providerGateway.improveHtml(pending.input.html, pending.prompt.prompt);
                if (generation !== this.improveGeneration) {
                    return;
                }

                await this.applyHtmlResult(improvedHtml, generation);
                return;
            }

            const sourceText = pending.input.html
                ? htmlToImprovableText(pending.input.html)
                : pending.input.text;
            const improvedText = await this.providerGateway.improve(sourceText, pending.prompt.prompt);
            if (generation !== this.improveGeneration) {
                return;
            }

            await this.applyResult(pending.prompt, improvedText, generation);
        } catch (error) {
            if (generation !== this.improveGeneration) {
                return;
            }

            console.error('Error improving sentence:', error);
            this.pendingImprove = null;
            await this.showImproveError(error);
            this.resetRunState();
        }
    }

    private async cancelImprove(): Promise<void> {
        if (this.state.runState !== 'improving') {
            return;
        }

        this.improveGeneration += 1;
        this.pendingImprove = null;
        await this.windows.hideStatus();
        this.resetRunState();
    }

    private async retryImprove(): Promise<void> {
        if (this.state.runState !== 'improving' || !this.pendingImprove) {
            return;
        }

        await this.runPendingImprove(false);
    }

    private async showImproveError(error: unknown): Promise<void> {
        const providerError = error as Error & { data?: { type?: string } };
        if (providerError.data?.type === 'quota') {
            await this.showStatus(
                'No tokens left! <a href="https://pasteai.app/tokens.html" target="_blank">Click here to recharge</a>',
                'error',
                { allowHtml: true }
            );
            return;
        }

        if (isLocalLlmMissing(error)) {
            await this.windows.openDashboard('providers');
        }

        await this.showStatus(
            `Could not improve sentence, please check your settings: ${error instanceof Error ? error.message : String(error)}`,
            'error'
        );
    }

    private async applyResult(prompt: PromptOption, improvedText: string, generation: number): Promise<void> {
        if (generation !== this.improveGeneration) {
            return;
        }

        if (prompt.outputMode === 'window') {
            this.pendingImprove = null;
            await this.windows.hideStatus();
            this.resetRunState();
            void this.windows.showAnswer(improvedText).catch((error) => {
                console.error('Failed to show answer window:', error);
            });
            return;
        }

        if (generation !== this.improveGeneration) {
            return;
        }

        this.pendingImprove = null;
        this.state.runState = 'applyingResult';
        this.state.suppressedClipboardText = improvedText;
        await clipboard.writeText(improvedText);
        await this.showStatus('Improved sentence ready', 'ok');
        this.enterCooldown();
    }

    private async shouldImproveAsHtml(input: ImproveInput, prompt: PromptOption): Promise<boolean> {
        if (!input.html || prompt.outputMode !== 'clipboard') {
            return false;
        }

        if (input.html.length > CONFIG.MAX_HTML_LENGTH) {
            return false;
        }

        return this.settingsRepository.get('improveHtml');
    }

    private async applyHtmlResult(improvedHtml: string, generation: number): Promise<void> {
        if (generation !== this.improveGeneration) {
            return;
        }

        const plainText = htmlToImprovableText(improvedHtml);

        if (generation !== this.improveGeneration) {
            return;
        }

        this.pendingImprove = null;
        this.state.runState = 'applyingResult';
        this.state.suppressedClipboardText = plainText;
        await clipboard.writeHtmlAndText(improvedHtml, plainText);
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
        this.pendingImprove = null;

        if (this.state.cooldownTimeout !== null) {
            window.clearTimeout(this.state.cooldownTimeout);
            this.state.cooldownTimeout = null;
        }
    }

    private async maybeLearnFromCopy(copied: string): Promise<boolean> {
        if (!this.learn) {
            return false;
        }

        if (Date.now() - this.learn.at > LEARN_TIMEOUT_MS) {
            this.learn = null;
            return false;
        }

        const settings = await this.settingsRepository.getAll();
        const inspection = inspectCopiedDictation(this.learn.text, copied, {
            vocabulary: settings.dictateVocabulary,
            replacements: settings.dictateReplacements
        });
        if (!inspection.similar) {
            return false;
        }

        this.learn = null;
        if (inspection.pairs.length === 0) {
            return true;
        }

        this.pendingLearn = inspection.pairs;
        await this.windows.showStatus({
            message: 'Add these dictionary rules?',
            type: 'info',
            autohide: true,
            pairs: inspection.pairs,
            actions: [
                { id: 'add', label: 'Add' },
                { id: 'skip', label: 'Skip' }
            ]
        });
        return true;
    }

    private async handleStatusAction(action: StatusActionPayload['action']): Promise<void> {
        if (action === 'cancel') {
            await this.cancelImprove();
            return;
        }

        if (action === 'retry') {
            await this.retryImprove();
            return;
        }

        const pairs = this.pendingLearn;
        this.pendingLearn = null;
        await this.windows.hideStatus();

        if (action !== 'add' || !pairs || pairs.length === 0) {
            return;
        }

        const settings = await this.settingsRepository.getAll();
        const replacements = [...settings.dictateReplacements];
        const vocabulary = [...settings.dictateVocabulary];
        const seenFrom = new Set(replacements.map((entry) => entry.from.toLowerCase()));

        for (const pair of pairs) {
            if (!seenFrom.has(pair.from.toLowerCase())) {
                seenFrom.add(pair.from.toLowerCase());
                replacements.push({ id: crypto.randomUUID(), from: pair.from, to: pair.to });
            }

            if (isSpeakableTerm(pair.to) && !vocabulary.includes(pair.to)) {
                vocabulary.push(pair.to);
            }
        }

        await this.settingsRepository.update({
            dictateReplacements: normalizeReplacements(replacements),
            dictateVocabulary: normalizeVocabulary(vocabulary)
        });
        await emit(APP_EVENTS.SETTINGS_CHANGED);
        await this.showStatus('Dictionary updated', 'ok');
    }

    private async showStatus(
        message: string,
        type: StatusType,
        options: { autohide?: boolean; allowHtml?: boolean; cancellable?: boolean } = {}
    ): Promise<void> {
        await this.windows.showStatus({
            message,
            type,
            autohide: options.autohide,
            allowHtml: options.allowHtml,
            cancellable: options.cancellable
        });
    }
}
