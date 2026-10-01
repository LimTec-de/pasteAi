import { BASE_TRANSCRIPTION_PROMPT } from '../domain/dictate-dictionary';

const TARGET_SAMPLE_RATE = 24000;
const PCM_CHUNK_SAMPLES = 2400;
const WORKLET_SOURCE = `
class PcmProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const channel = inputs[0]?.[0];
        if (channel && channel.length > 0) {
            this.port.postMessage(channel.slice());
        }
        return true;
    }
}
registerProcessor('pcm-processor', PcmProcessor);
`;

const COMMIT_TIMEOUT_MS = 15_000;

async function addPcmWorklet(audioContext: AudioContext): Promise<void> {
    const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    try {
        await audioContext.audioWorklet.addModule(workletUrl);
    } finally {
        URL.revokeObjectURL(workletUrl);
    }
}

// A running AudioContext keeps the output device open and blocks idle sleep, so it only runs while recording.
class DictateAudioGraph {
    private context: AudioContext | null = null;
    private workletReady: Promise<void> | null = null;
    private users = 0;
    private transition: Promise<void> = Promise.resolve();

    async prewarm(): Promise<void> {
        const context = await this.load();
        if (this.users === 0) {
            await this.setRunning(context, false);
        }
    }

    async acquire(): Promise<AudioContext> {
        const context = await this.load();
        this.users += 1;
        try {
            await this.setRunning(context, true);
        } catch (error) {
            this.release();
            throw error;
        }

        return context;
    }

    release(): void {
        this.users -= 1;
        if (this.users === 0 && this.context) {
            void this.setRunning(this.context, false);
        }
    }

    private async load(): Promise<AudioContext> {
        if (!this.context || this.context.state === 'closed') {
            this.context = new AudioContext();
            this.workletReady = addPcmWorklet(this.context);
        }

        const context = this.context;
        try {
            await this.workletReady;
        } catch (error) {
            if (context.state !== 'closed') {
                void context.close();
            }
            if (this.context === context) {
                this.context = null;
                this.workletReady = null;
            }
            throw error;
        }

        return context;
    }

    private setRunning(context: AudioContext, running: boolean): Promise<void> {
        this.transition = this.transition
            .catch(() => undefined)
            .then(() => (running ? context.resume() : context.suspend()));
        return this.transition;
    }
}

export const dictateAudioGraph = new DictateAudioGraph();

export function transcriptionSessionUpdate(
    languages: string[],
    keywords: string[] = [],
    prompt = BASE_TRANSCRIPTION_PROMPT
) {
    return {
        type: 'session.update',
        session: {
            type: 'transcription',
            audio: {
                input: {
                    format: {
                        type: 'audio/pcm',
                        rate: TARGET_SAMPLE_RATE
                    },
                    transcription: {
                        model: 'gpt-transcribe',
                        prompt,
                        languages,
                        ...(keywords.length > 0 ? { keywords } : {})
                    },
                    turn_detection: null
                }
            }
        }
    };
}

export interface TranscriptionHandlers {
    onDelta: (itemId: string, delta: string) => void;
    onCompleted: (itemId: string, transcript: string) => void;
    onLevel: (level: number) => void;
    onError: (message: string) => void;
    onReady?: () => void;
}

interface RealtimeEvent {
    type?: string;
    item_id?: string;
    delta?: string;
    transcript?: string;
    error?: { message?: string; code?: string } | string;
}

export class TranscriptionError extends Error {
    constructor(message: string, readonly detail: string) {
        super(message);
    }
}

export class LiveTranscriptionSession {
    private socket: WebSocket | null = null;
    private stream: MediaStream | null = null;
    private audioContext: AudioContext | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private analyser: AnalyserNode | null = null;
    private muteNode: GainNode | null = null;
    private pcmRemainder = new Float32Array(0);
    private levelFrame = 0;
    private ready = false;
    private closed = false;
    private sentAudio = false;
    private commitConfirmed = false;
    private commitWaiters: Array<(error?: Error) => void> = [];
    private capturing = false;
    private resolveCapturing: (() => void) | null = null;
    private recording: Float32Array[] = [];

    constructor(private readonly handlers: TranscriptionHandlers) {}

    private pendingPcm: Float32Array[] = [];
    private connected = false;
    private connectWaiters: Array<(error?: Error) => void> = [];
    private connectError: Error | null = null;

    isConnected(): boolean {
        return this.connected && this.socket?.readyState === WebSocket.OPEN;
    }

    async waitUntilConnected(timeoutMs = COMMIT_TIMEOUT_MS): Promise<void> {
        if (this.isConnected()) {
            return;
        }

        if (this.connectError) {
            throw this.connectError;
        }

        await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => {
                reject(new TranscriptionError('Could not connect to OpenAI', this.connectTimeoutDetail(timeoutMs)));
            }, timeoutMs);

            this.connectWaiters.push((error) => {
                window.clearTimeout(timer);
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }

    async startMic(options: { microphoneId?: string }): Promise<void> {
        const audio: MediaTrackConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1
        };
        if (options.microphoneId) {
            audio.deviceId = { exact: options.microphoneId };
        }

        this.stream = await navigator.mediaDevices.getUserMedia({ audio });
        if (this.closed) {
            this.stream.getTracks().forEach((track) => track.stop());
            this.stream = null;
            return;
        }

        const capturing = new Promise<void>((resolve) => {
            this.resolveCapturing = resolve;
        });
        await this.startMicPipeline();
        await capturing;
    }

    recordedAudio(): Float32Array[] {
        return this.recording;
    }

    loadRecording(recording: Float32Array[]): void {
        this.recording = recording;
        this.pendingPcm = [...recording];
    }

    async connect(
        clientSecret: string,
        options: { languages: string[]; keywords?: string[]; prompt?: string }
    ): Promise<void> {
        this.connectError = null;
        this.socket = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', [
            'realtime',
            `openai-insecure-api-key.${clientSecret}`
        ]);

        this.socket.addEventListener('open', () => {
            if (this.closed) {
                return;
            }

            this.socket?.send(JSON.stringify(transcriptionSessionUpdate(
                options.languages,
                options.keywords ?? [],
                options.prompt
            )));
        });

        this.socket.addEventListener('message', (event) => {
            if (this.closed) {
                return;
            }

            this.handleSocketMessage(String(event.data));
        });

        this.socket.addEventListener('error', () => {
            this.handlers.onError('Transcription connection failed');
        });

        this.socket.addEventListener('close', (event) => {
            this.ready = false;
            this.connected = false;
            const error = new TranscriptionError(
                'Connection to OpenAI closed',
                `WebSocket closed with code ${event.code}${event.reason ? `: ${event.reason}` : ''}.`
            );
            this.settleConnect(error);
            this.settleCommit(error);
        });
    }

    async start(clientSecret: string, options: { languages: string[]; keywords?: string[]; prompt?: string; microphoneId?: string }): Promise<void> {
        await this.startMic({ microphoneId: options.microphoneId });
        await this.connect(clientSecret, options);
    }

    async commitAndWait(timeoutMs = COMMIT_TIMEOUT_MS): Promise<void> {
        this.ready = false;
        this.flushPcmRemainder();

        if (!this.sentAudio) {
            return;
        }

        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw this.connectError ?? new TranscriptionError('Connection to OpenAI closed', 'WebSocket was not open when the audio was committed.');
        }

        const completed = new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => {
                this.settleCommit(new TranscriptionError('Transcription timed out', this.commitTimeoutDetail(timeoutMs)));
            }, timeoutMs);

            this.commitWaiters.push((error) => {
                window.clearTimeout(timer);
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });

        this.socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        await completed;
    }

    stop(): void {
        this.closed = true;
        this.ready = false;
        this.connected = false;
        this.settleConnect(new Error('Transcription stopped'));
        this.settleCommit(new Error('Transcription stopped'));
        this.resolveCapturing?.();

        if (this.levelFrame !== 0) {
            cancelAnimationFrame(this.levelFrame);
            this.levelFrame = 0;
        }

        this.workletNode?.port.close();
        this.workletNode?.disconnect();
        this.sourceNode?.disconnect();
        this.analyser?.disconnect();
        this.muteNode?.disconnect();
        this.workletNode = null;
        this.sourceNode = null;
        this.analyser = null;
        this.muteNode = null;
        if (this.audioContext) {
            dictateAudioGraph.release();
            this.audioContext = null;
        }

        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;

        if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
            this.socket.close();
        }
        this.socket = null;
    }

    private markSessionReady(): void {
        if (this.closed || this.ready) {
            return;
        }

        this.ready = true;
        this.connected = true;
        this.flushPendingPcm();
        this.settleConnect();
        this.handlers.onReady?.();
    }

    private async startMicPipeline(): Promise<void> {
        if (!this.stream) {
            throw new Error('Microphone stream missing');
        }

        const audioContext = await dictateAudioGraph.acquire();
        if (this.closed) {
            dictateAudioGraph.release();
            return;
        }

        this.audioContext = audioContext;

        const source = audioContext.createMediaStreamSource(this.stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        const worklet = new AudioWorkletNode(audioContext, 'pcm-processor');

        worklet.port.onmessage = (event) => {
            if (this.closed) {
                return;
            }

            const input = event.data as Float32Array;
            if (!this.capturing) {
                if (!hasSignal(input)) {
                    return;
                }
                this.capturing = true;
                this.resolveCapturing?.();
            }

            const resampled = resample(input, audioContext.sampleRate, TARGET_SAMPLE_RATE);
            this.recording.push(resampled);
            if (!this.ready) {
                this.pendingPcm.push(resampled);
                return;
            }

            this.enqueuePcm(resampled);
        };

        const mute = audioContext.createGain();
        mute.gain.value = 0;
        source.connect(analyser);
        source.connect(worklet);
        worklet.connect(mute);
        mute.connect(audioContext.destination);
        this.sourceNode = source;
        this.analyser = analyser;
        this.workletNode = worklet;
        this.muteNode = mute;
        this.pumpLevel();
    }

    private enqueuePcm(samples: Float32Array): void {
        if (samples.length === 0) {
            return;
        }

        const merged = new Float32Array(this.pcmRemainder.length + samples.length);
        merged.set(this.pcmRemainder);
        merged.set(samples, this.pcmRemainder.length);

        let offset = 0;
        while (offset + PCM_CHUNK_SAMPLES <= merged.length) {
            const chunk = merged.subarray(offset, offset + PCM_CHUNK_SAMPLES);
            this.sendPcm(chunk);
            offset += PCM_CHUNK_SAMPLES;
        }

        this.pcmRemainder = merged.slice(offset);
    }

    private flushPcmRemainder(): void {
        if (this.pcmRemainder.length === 0) {
            return;
        }

        this.sendPcm(this.pcmRemainder);
        this.pcmRemainder = new Float32Array(0);
    }

    private flushPendingPcm(): void {
        const pending = this.pendingPcm;
        this.pendingPcm = [];
        for (const chunk of pending) {
            this.enqueuePcm(chunk);
        }
    }

    private settleConnect(error?: Error): void {
        if (error) {
            this.connectError = error;
        }
        const waiters = this.connectWaiters;
        this.connectWaiters = [];
        for (const waiter of waiters) {
            waiter(error);
        }
    }

    private settleCommit(error?: Error): void {
        const waiters = this.commitWaiters;
        this.commitWaiters = [];
        for (const waiter of waiters) {
            waiter(error);
        }
    }

    private connectTimeoutDetail(timeoutMs: number): string {
        const seconds = timeoutMs / 1000;
        if (!this.socket) {
            return `No OpenAI session key within ${seconds} s.`;
        }

        if (this.socket.readyState === WebSocket.CONNECTING) {
            return `The WebSocket to OpenAI did not open within ${seconds} s.`;
        }

        return `OpenAI did not confirm the transcription session within ${seconds} s.`;
    }

    private commitTimeoutDetail(timeoutMs: number): string {
        const samples = this.recording.reduce((total, chunk) => total + chunk.length, 0);
        const queuedKb = Math.round((this.socket?.bufferedAmount ?? 0) / 1024);
        return `No transcript from OpenAI within ${timeoutMs / 1000} s after ${(samples / TARGET_SAMPLE_RATE).toFixed(1)} s of audio. `
            + `OpenAI confirmed receiving the audio: ${this.commitConfirmed ? 'yes' : 'no'}. `
            + `Upload still queued: ${queuedKb} KB.`;
    }

    private sendPcm(samples: Float32Array): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return;
        }

        this.socket.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: floatToBase64Pcm16(samples)
        }));
        this.sentAudio = true;
    }

    private pumpLevel(): void {
        const analyser = this.analyser;
        if (!analyser || this.closed) {
            return;
        }

        const data = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const sample of data) {
            const centered = (sample - 128) / 128;
            sum += centered * centered;
        }
        this.handlers.onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        this.levelFrame = requestAnimationFrame(() => this.pumpLevel());
    }

    private handleSocketMessage(raw: string): void {
        let event: RealtimeEvent;
        try {
            event = JSON.parse(raw) as RealtimeEvent;
        } catch {
            return;
        }

        switch (event.type) {
            case 'session.updated':
                this.markSessionReady();
                break;
            case 'conversation.item.input_audio_transcription.delta':
                if (event.item_id && event.delta) {
                    this.handlers.onDelta(event.item_id, event.delta);
                }
                break;
            case 'conversation.item.input_audio_transcription.completed':
                if (event.item_id) {
                    this.handlers.onCompleted(event.item_id, event.transcript ?? '');
                }
                this.settleCommit();
                break;
            case 'input_audio_buffer.committed':
                this.commitConfirmed = true;
                break;
            case 'conversation.item.input_audio_transcription.failed':
                this.settleCommit(new TranscriptionError('OpenAI could not transcribe the audio', realtimeErrorDetail(event.error)));
                break;
            case 'error': {
                const detail = realtimeErrorDetail(event.error);
                const error = new TranscriptionError('OpenAI transcription error', detail);
                if (!this.connected) {
                    this.settleConnect(error);
                }
                this.settleCommit(error);
                this.handlers.onError(detail);
                break;
            }
            default:
                break;
        }
    }
}

export class MicrophoneCapture {
    private stream: MediaStream | null = null;
    private audioContext: AudioContext | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private analyser: AnalyserNode | null = null;
    private muteNode: GainNode | null = null;
    private levelFrame = 0;
    private closed = false;
    private capturing = false;
    private resolveCapturing: (() => void) | null = null;
    private chunks: Float32Array[] = [];
    private sampleRate = 48000;

    constructor(private readonly onLevel: (level: number) => void) {}

    async start(microphoneId?: string): Promise<void> {
        const audio: MediaTrackConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1
        };
        if (microphoneId) {
            audio.deviceId = { exact: microphoneId };
        }

        this.stream = await navigator.mediaDevices.getUserMedia({ audio });
        const audioContext = await dictateAudioGraph.acquire();
        if (this.closed) {
            dictateAudioGraph.release();
            this.stream.getTracks().forEach((track) => track.stop());
            this.stream = null;
            return;
        }

        this.audioContext = audioContext;
        this.sampleRate = audioContext.sampleRate;

        const capturing = new Promise<void>((resolve) => {
            this.resolveCapturing = resolve;
        });
        const source = audioContext.createMediaStreamSource(this.stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        const worklet = new AudioWorkletNode(audioContext, 'pcm-processor');
        worklet.port.onmessage = (event) => {
            if (this.closed) {
                return;
            }

            const input = event.data as Float32Array;
            if (!this.capturing) {
                if (!hasSignal(input)) {
                    return;
                }
                this.capturing = true;
                this.resolveCapturing?.();
            }

            this.chunks.push(input);
        };

        const mute = audioContext.createGain();
        mute.gain.value = 0;
        source.connect(analyser);
        source.connect(worklet);
        worklet.connect(mute);
        mute.connect(audioContext.destination);
        this.sourceNode = source;
        this.analyser = analyser;
        this.workletNode = worklet;
        this.muteNode = mute;
        this.pumpLevel();
        await capturing;
    }

    takePcm16(): { pcm: Uint8Array; sampleRate: number } {
        let total = 0;
        for (const chunk of this.chunks) {
            total += chunk.length;
        }

        const merged = new Float32Array(total);
        let offset = 0;
        for (const chunk of this.chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
        }

        return {
            pcm: floatToPcm16Le(merged),
            sampleRate: this.sampleRate
        };
    }

    stop(): void {
        this.closed = true;
        this.resolveCapturing?.();
        if (this.levelFrame !== 0) {
            cancelAnimationFrame(this.levelFrame);
            this.levelFrame = 0;
        }

        this.workletNode?.port.close();
        this.workletNode?.disconnect();
        this.sourceNode?.disconnect();
        this.analyser?.disconnect();
        this.muteNode?.disconnect();
        this.workletNode = null;
        this.sourceNode = null;
        this.analyser = null;
        this.muteNode = null;
        if (this.audioContext) {
            dictateAudioGraph.release();
            this.audioContext = null;
        }
        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;
    }

    private pumpLevel(): void {
        const analyser = this.analyser;
        if (!analyser || this.closed) {
            return;
        }

        const data = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const sample of data) {
            const centered = (sample - 128) / 128;
            sum += centered * centered;
        }
        this.onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        this.levelFrame = requestAnimationFrame(() => this.pumpLevel());
    }
}

// WebKit feeds exact zeros until the capture device delivers samples; getUserMedia resolves before that.
function hasSignal(samples: Float32Array): boolean {
    return samples.some((sample) => sample !== 0);
}

function realtimeErrorDetail(error: RealtimeEvent['error']): string {
    if (typeof error === 'string') {
        return error;
    }

    const message = error?.message || 'No error message from OpenAI.';
    return error?.code ? `${message} (${error.code})` : message;
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) {
        return input;
    }

    const ratio = fromRate / toRate;
    const outLength = Math.max(1, Math.floor(input.length / ratio));
    const output = new Float32Array(outLength);

    for (let index = 0; index < outLength; index += 1) {
        const source = index * ratio;
        const left = Math.floor(source);
        const fraction = source - left;
        const a = input[left] ?? 0;
        const b = input[left + 1] ?? a;
        output[index] = a + ((b - a) * fraction);
    }

    return output;
}

function floatToBase64Pcm16(samples: Float32Array): string {
    const bytes = new Uint8Array(samples.length * 2);
    const view = new DataView(bytes.buffer);

    for (let index = 0; index < samples.length; index += 1) {
        const clipped = Math.max(-1, Math.min(1, samples[index] ?? 0));
        view.setInt16(index * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
    }

    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }

    return btoa(binary);
}

function floatToPcm16Le(samples: Float32Array): Uint8Array {
    const bytes = new Uint8Array(samples.length * 2);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < samples.length; index += 1) {
        const clipped = Math.max(-1, Math.min(1, samples[index] ?? 0));
        view.setInt16(index * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
    }

    return bytes;
}
