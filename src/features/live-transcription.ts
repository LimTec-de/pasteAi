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
}

interface RealtimeEvent {
    type?: string;
    item_id?: string;
    delta?: string;
    transcript?: string;
    error?: { message?: string } | string;
}

export class LiveTranscriptionSession {
    private socket: WebSocket | null = null;
    private stream: MediaStream | null = null;
    private audioContext: AudioContext | null = null;
    private workletNode: AudioWorkletNode | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private analyser: AnalyserNode | null = null;
    private pcmRemainder = new Float32Array(0);
    private levelFrame = 0;
    private ready = false;
    private closed = false;
    private sentAudio = false;
    private commitWaiters: Array<(error?: Error) => void> = [];

    constructor(private readonly handlers: TranscriptionHandlers) {}

    async start(clientSecret: string, options: { languages: string[]; keywords?: string[]; prompt?: string; microphoneId?: string }): Promise<void> {
        const audio: MediaTrackConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1
        };
        if (options.microphoneId) {
            audio.deviceId = { exact: options.microphoneId };
        }

        this.stream = await navigator.mediaDevices.getUserMedia({ audio });

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
            this.ready = true;
        });

        this.socket.addEventListener('message', (event) => {
            if (this.closed) {
                return;
            }

            this.handleSocketMessage(String(event.data));
        });

        this.socket.addEventListener('error', () => {
            this.settleCommit(new Error('Transcription connection failed'));
            this.handlers.onError('Transcription connection failed');
        });

        this.socket.addEventListener('close', () => {
            this.ready = false;
            this.settleCommit(new Error('Transcription connection closed'));
        });

        await this.startMicPipeline();
    }

    async commitAndWait(timeoutMs = COMMIT_TIMEOUT_MS): Promise<void> {
        this.ready = false;
        this.flushPcmRemainder();

        if (!this.sentAudio) {
            return;
        }

        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error('Transcription connection closed');
        }

        const completed = new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => {
                this.settleCommit(new Error('Transcription timed out'));
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
        this.settleCommit(new Error('Transcription stopped'));

        if (this.levelFrame !== 0) {
            cancelAnimationFrame(this.levelFrame);
            this.levelFrame = 0;
        }

        this.workletNode?.port.close();
        this.workletNode?.disconnect();
        this.sourceNode?.disconnect();
        this.analyser?.disconnect();
        this.workletNode = null;
        this.sourceNode = null;
        this.analyser = null;

        this.stream?.getTracks().forEach((track) => track.stop());
        this.stream = null;

        if (this.audioContext) {
            void this.audioContext.close();
            this.audioContext = null;
        }

        if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
            this.socket.close();
        }
        this.socket = null;
    }

    private async startMicPipeline(): Promise<void> {
        if (!this.stream) {
            throw new Error('Microphone stream missing');
        }

        const audioContext = new AudioContext();
        this.audioContext = audioContext;
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(blob);

        try {
            await audioContext.audioWorklet.addModule(workletUrl);
        } finally {
            URL.revokeObjectURL(workletUrl);
        }

        const source = audioContext.createMediaStreamSource(this.stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        const worklet = new AudioWorkletNode(audioContext, 'pcm-processor');

        worklet.port.onmessage = (event) => {
            if (this.closed || !this.ready) {
                return;
            }

            const input = event.data as Float32Array;
            this.enqueuePcm(resample(input, audioContext.sampleRate, TARGET_SAMPLE_RATE));
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

    private settleCommit(error?: Error): void {
        const waiters = this.commitWaiters;
        this.commitWaiters = [];
        for (const waiter of waiters) {
            waiter(error);
        }
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
            case 'error': {
                const message = typeof event.error === 'string' ? event.error : event.error?.message || 'Transcription error';
                this.settleCommit(new Error(message));
                this.handlers.onError(message);
                break;
            }
            default:
                break;
        }
    }
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
