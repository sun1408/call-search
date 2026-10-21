import { formatBytes, formatClock } from '../core/format';
import type { AsrReply, AsrRequest } from '../core/asr-protocol';
import { SAMPLE_RATE, decodeToMono16k } from './audio';
import type { Transcriber, Transcript } from './importer';
import { MODEL_CACHE, SENSEVOICE, downloadPack, isPackCached, type ModelPack } from './models';

const IDLE_RELEASE_MS = 120_000;

export class SenseVoiceTranscriber implements Transcriber {
  readonly pack = SENSEVOICE;
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly askDownload: (pack: ModelPack) => Promise<boolean>) {}

  async prepare(onProgress: (fraction: number, detail: string) => void): Promise<boolean> {
    clearTimeout(this.idleTimer);
    if (!(await isPackCached(this.pack))) {
      if (!(await this.askDownload(this.pack))) return false;
      await downloadPack(this.pack, (loaded, total) => onProgress(loaded / total, `모델 내려받는 중 ${formatBytes(loaded)} / ${formatBytes(total)}`));
    }
    onProgress(0, '음성 인식 엔진 준비 중');
    await this.start();
    return true;
  }

  private send(request: AsrRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(request, transfer);
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const worker = new Worker(new URL('asr-worker.js', document.baseURI), { name: 'asr' });
    this.worker = worker;
    this.ready = new Promise<void>((resolve, reject) => {
      const done = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      const onMessage = (event: MessageEvent<AsrReply>) => {
        const reply = event.data;
        if (reply.type === 'ready') {
          console.info(`[asr] engine ready in ${Math.round(reply.ms)} ms`);
          done();
          resolve();
        } else if (reply.type === 'error' && reply.id === undefined) {
          done();
          reject(new Error(reply.message));
        }
      };
      const onError = (event: ErrorEvent) => {
        done();
        reject(new Error(event.message || '음성 인식 엔진을 시작하지 못했어요.'));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
    });
    this.ready.catch(() => this.release());
    this.send({ type: 'init', cache: MODEL_CACHE, modelUrl: this.pack.files[0]!.url, tokensUrl: this.pack.files[1]!.url, language: 'ko' });
    return this.ready;
  }

  async transcribe(audio: Blob, onProgress: (fraction: number, detail: string) => void): Promise<Transcript> {
    clearTimeout(this.idleTimer);
    onProgress(0, '소리를 읽는 중');
    const { samples, duration } = await decodeToMono16k(audio);
    await this.start();
    const worker = this.worker!;
    const id = this.nextId++;
    const total = formatClock(samples.length / SAMPLE_RATE);
    return new Promise<Transcript>((resolve, reject) => {
      const done = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      const onMessage = (event: MessageEvent<AsrReply>) => {
        const reply = event.data;
        if (!('id' in reply) || reply.id !== id) return;
        if (reply.type === 'progress') {
          onProgress(reply.done / reply.total, `글로 바꾸는 중 ${formatClock(reply.done / SAMPLE_RATE)} / ${total}`);
        } else if (reply.type === 'result') {
          console.info(`[asr] transcribed ${duration.toFixed(1)} s of audio in ${Math.round(reply.ms)} ms (${reply.segments.length} segments)`);
          done();
          resolve({ text: reply.segments.map((s) => s.text).join('\n'), segments: reply.segments, durationSec: duration, engine: this.pack.id });
        } else if (reply.type === 'error') {
          done();
          reject(new Error(reply.message));
        }
      };
      const onError = (event: ErrorEvent) => {
        done();
        this.release();
        reject(new Error(event.message || '음성 인식 엔진이 멈췄어요. 메모리가 부족했을 수 있어요.'));
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      this.send({ type: 'transcribe', id, samples }, [samples.buffer]);
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
