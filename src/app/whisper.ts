import { WHISPER_MODEL, type ModelChoice, type WhisperReply, type WhisperRequest } from '../core/ai-protocol';
import { splitAtSilence } from '../core/audio-split';
import { formatBytes } from '../core/format';
import type { Store } from '../core/store';
import { isModelCached, type Support } from './ai';
import { SAMPLE_RATE, decodeToMono16k } from './audio';
import type { Transcriber, Transcript } from './importer';

const OVERRIDE_KEY = 'cs.whisperModel';
const IDLE_RELEASE_MS = 120_000;

/** The Whisper model to use. Developers and the E2E test can set `localStorage['cs.whisperModel']` to a smaller model on WASM. */
export function whisperModel(): { model: ModelChoice; overridden: boolean } {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ModelChoice>;
      if (typeof parsed.id === 'string' && typeof parsed.revision === 'string' && parsed.dtype && typeof parsed.bytes === 'number') {
        return { model: { label: parsed.id, device: 'wasm', ...parsed } as ModelChoice, overridden: true };
      }
    }
  } catch {
    // a malformed override falls back to the default model
  }
  return { model: WHISPER_MODEL, overridden: false };
}

export class WhisperTranscriber implements Transcriber {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly store: Store,
    private readonly askDownload: (label: string, bytes: number) => Promise<boolean>,
    private readonly support: () => Promise<Support>,
  ) {}

  async available(): Promise<Support> {
    if (whisperModel().overridden) return { ok: true, reason: '' };
    return this.support();
  }

  async prepare(onProgress: (fraction: number, detail: string) => void): Promise<boolean> {
    clearTimeout(this.idleTimer);
    const { model } = whisperModel();
    const support = await this.available();
    if (!support.ok) throw new Error(`${support.reason} 설정에서 음성 인식 엔진을 SenseVoice로 바꿔 주세요.`);
    const consented = (await this.store.getSetting<boolean>(`consent:${model.id}`)) || (await isModelCached(model));
    if (!consented) {
      if (!(await this.askDownload(model.label, model.bytes))) return false;
      await this.store.setSetting(`consent:${model.id}`, true);
    }
    await this.start(model, (loaded, total) => onProgress(loaded / Math.max(1, total), `Whisper 모델 준비 중 ${formatBytes(loaded)} / ${formatBytes(total)}`));
    return true;
  }

  private start(model: ModelChoice, onProgress: (loaded: number, total: number) => void): Promise<void> {
    if (this.ready) return this.ready;
    const worker = new Worker(new URL('whisper-worker.js', document.baseURI), { type: 'module', name: 'whisper' });
    this.worker = worker;
    this.ready = new Promise<void>((resolve, reject) => {
      const done = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      const onMessage = (event: MessageEvent<WhisperReply>) => {
        const reply = event.data;
        if (reply.type === 'progress') onProgress(reply.loaded, reply.total);
        else if (reply.type === 'ready') {
          console.info(`[asr] whisper ready in ${Math.round(reply.ms)} ms`);
          done();
          resolve();
        } else if (reply.type === 'error' && reply.id === undefined) {
          done();
          reject(new Error(reply.message));
        }
      };
      const onError = (event: ErrorEvent) => {
        done();
        reject(new Error(event.message || 'Whisper를 시작하지 못했어요.'));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
    });
    this.ready.catch(() => this.release());
    worker.postMessage({ type: 'load', model } satisfies WhisperRequest);
    return this.ready;
  }

  async transcribe(audio: Blob, onProgress: (fraction: number, detail: string) => void): Promise<Transcript> {
    clearTimeout(this.idleTimer);
    onProgress(0, '소리를 읽는 중');
    const { samples, duration } = await decodeToMono16k(audio);
    const pieces = splitAtSilence(samples, SAMPLE_RATE);
    const worker = this.worker;
    if (!worker) throw new Error('Whisper가 준비되지 않았어요.');
    const { model } = whisperModel();
    const id = this.nextId++;
    return new Promise<Transcript>((resolve, reject) => {
      const done = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      const onMessage = (event: MessageEvent<WhisperReply>) => {
        const reply = event.data;
        if (!('id' in reply) || reply.id !== id) return;
        if (reply.type === 'piece') onProgress(reply.done / reply.total, `Whisper로 글로 바꾸는 중 ${reply.done}/${reply.total}`);
        else if (reply.type === 'result') {
          console.info(`[asr] whisper transcribed ${duration.toFixed(1)} s of audio in ${Math.round(reply.ms)} ms`);
          done();
          resolve({ text: reply.segments.map((s) => s.text).join('\n'), segments: reply.segments, durationSec: duration, engine: model.id });
        } else if (reply.type === 'error') {
          done();
          reject(new Error(reply.message));
        }
      };
      const onError = (event: ErrorEvent) => {
        done();
        this.release();
        reject(new Error(event.message || 'Whisper가 멈췄어요. 메모리가 부족했을 수 있어요.'));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ type: 'transcribe', id, samples, pieces, sampleRate: SAMPLE_RATE } satisfies WhisperRequest, [samples.buffer]);
    });
  }

  idle(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.release(), IDLE_RELEASE_MS);
  }

  release(): void {
    clearTimeout(this.idleTimer);
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}

export type EngineId = 'sensevoice' | 'whisper';

export class EngineSwitch implements Transcriber {
  constructor(
    private readonly store: Store,
    private readonly engines: Record<EngineId, Transcriber>,
  ) {}

  async engine(): Promise<EngineId> {
    return (await this.store.getSetting<EngineId>('asrEngine')) === 'whisper' ? 'whisper' : 'sensevoice';
  }

  async prepare(onProgress: (fraction: number, detail: string) => void): Promise<boolean> {
    return this.engines[await this.engine()].prepare(onProgress);
  }

  async transcribe(audio: Blob, onProgress: (fraction: number, detail: string) => void): Promise<Transcript> {
    return this.engines[await this.engine()].transcribe(audio, onProgress);
  }

  idle(): void {
    for (const engine of Object.values(this.engines)) engine.idle?.();
  }
}
