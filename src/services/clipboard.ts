import { onTextUpdate, startListening } from "tauri-plugin-clipboard-api";
import clipboard from "tauri-plugin-clipboard-api";
import { CONFIG } from '../config';
import { Services } from '../types';
import { LLMService, StatusWindow, StatusType } from '.';

interface ClipboardState {
    clipboardContent: string;
    lastUpdateTime: number;
    lastImprovedContent: string;
    lastNotImprovedContent: string;
    copyCount: number;
    isOldCopy: boolean;
}

export class ClipboardMonitor {
    private static state: ClipboardState = {
        clipboardContent: "",
        lastUpdateTime: 0,
        lastImprovedContent: "",
        lastNotImprovedContent: "",
        copyCount: 0,
        isOldCopy: true
    };

    static async initialize(services: Services) {
        services.unlistenTextUpdate = await onTextUpdate(async (newText) => {
            const currentTime = Date.now();
            const lastCopy = currentTime - this.state.lastUpdateTime;

            this.state.isOldCopy = currentTime - this.state.lastUpdateTime > CONFIG.COPY_DETECTION_INTERVAL_MAX;
            if (currentTime > this.state.lastUpdateTime) {
                this.state.lastUpdateTime = currentTime;
            }

            if (lastCopy < CONFIG.COPY_DETECTION_INTERVAL) {
                console.log('Copy too fast! ' + (lastCopy));
            } else {
                console.log('Copy ' + (lastCopy));
                await this.handleTextUpdate(newText, services);
            }
        });

        services.unlistenClipboard = await startListening();
    }

    private static async handleTextUpdate(newText: string, services: Services) {
        if (this.shouldSkipImprovement(newText)) {
            await this.handleSkippedImprovement();
            return;
        }

        await this.updateClipboardState(newText);

        if (this.shouldImproveText(newText)) {
            if (newText.length > CONFIG.MAX_TEXT_LENGTH) {
                await StatusWindow.display(`Text too long (>${CONFIG.MAX_TEXT_LENGTH} chars), skipping improvement`, StatusType.ERROR);
                return;
            } else {
                await this.improveAndUpdateClipboard(newText, services);
            }
        } else {
            console.log(`Skipping improvement`);
            console.log(`----------------------------------------------------------------------`);
        }
    }

    private static shouldSkipImprovement(newText: string): boolean {
        return newText === this.state.lastNotImprovedContent && newText !== this.state.lastImprovedContent;
    }

    private static async handleSkippedImprovement() {
        if (this.state.lastImprovedContent) {
            await clipboard.writeText(this.state.lastImprovedContent);
        }
    }

    private static async updateClipboardState(newText: string) {
        if (newText === this.state.clipboardContent) {
            if (this.state.isOldCopy) {
                console.log(`Old copy detected`);
                this.state.copyCount = 1;
            } else {
                this.state.copyCount++;
                console.log('copyCount++')
            }
        } else {
            this.state.copyCount = 1;
        }

        console.log(`Copy count = ${this.state.copyCount}, isOldCopy = ${this.state.isOldCopy}`);
        this.state.clipboardContent = newText;
    }

    private static shouldImproveText(newText: string): boolean {
        return this.state.copyCount >= CONFIG.COPY_THRESHOLD && newText !== this.state.lastNotImprovedContent;
    }

    private static async improveAndUpdateClipboard(newText: string, services: Services) {
        this.state.lastNotImprovedContent = newText;

        try {
            await StatusWindow.display('Starting to improve sentence', StatusType.WORKING);

            this.state.lastImprovedContent = await LLMService.improveSentence(newText, services);
            await clipboard.writeText(this.state.lastImprovedContent);

            await StatusWindow.display('Improved sentence ready', StatusType.OK);
        } catch (error) {
            console.error("Error improving sentence:", error);
            await StatusWindow.display(
                `Could not improve sentence, please check your settings: ${error instanceof Error ? error.message : String(error)}`,
                StatusType.ERROR
            );
        }
    }
} 