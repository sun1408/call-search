import { CHAT_MODELS, EMBEDDING_MODEL, type EmbedReply, type EmbedRequest, type LlmReply, type LlmRequest, type ModelChoice } from '../core/ai-protocol';
import { chunkText } from '../core/chunking';
import type { ChatMessage } from '../core/prompt';
import type { Store } from '../core/store';
import { embeddingText } from '../core/text';
import type { CallRecord, Chunk } from '../core/types';

const INDEX_KEY = 'semanticIndex';
const INDEX_VERSION = `${EMBEDDING_MODEL.id}@${EMBEDDING_MODEL.revision}#particles-v1`;
const TRANSFORMERS_CACHE = 'transformers-cache';

interface IndexState {
  model: string;
  records: Record<string, number>;
}

export type IndexStatus =
  | { state: 'off' }
  | { state: 'loading'; loaded: number; total: number }
  | { state: 'indexing'; done: number; total: number }
  | { state: 'ready'; chunks: number }
  | { state: 'error'; message: string };

export async function deleteCachedModel(model: ModelChoice): Promise<void> {
  const cache = await caches.open(TRANSFORMERS_CACHE);
  for (const request of await cache.keys()) {
    if (request.url.includes(`/${model.id}/`)) await cache.delete(request);
  }
}

export async function isModelCached(model: ModelChoice): Promise<boolean> {
  const cache = await caches.open(TRANSFORMERS_CACHE);
  return (await cache.keys()).some((request) => request.url.includes(`/${model.id}/`) && request.url.endsWith('.onnx'));
}

export class SemanticIndex {
  status: IndexStatus = { state: 'off' };
  chunks: Chunk[] = [];
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private syncing: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (vectors: Float32Array[]) => void; reject: (error: Error) => void }>();

  constructor(
    private readonly store: Store,
    private readonly changed: () => void,
  ) {}

  async isEnabled(): Promise<boolean> {
    return (await this.store.getSetting<boolean>('semanticEnabled')) === true;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.store.setSetting('semanticEnabled', enabled);
    if (!enabled) {
      this.stop();
      this.chunks = [];
      await this.store.setSetting(INDEX_KEY, { model: INDEX_VERSION, records: {} });
      await deleteCachedModel(EMBEDDING_MODEL);
      this.setStatus({ state: 'off' });
    }
  }

  get isReady(): boolean {
    return this.status.state === 'ready';
  }

  private setStatus(status: IndexStatus): void {
    this.status = status;
    this.changed();
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const worker = new Worker(new URL('embed-worker.js', document.baseURI), { type: 'module', name: 'embed' });
    this.worker = worker;
    this.ready = new Promise<void>((resolve, reject) => {
      worker.addEventListener('message', (event: MessageEvent<EmbedReply>) => {
        const reply = event.data;
        if (reply.type === 'progress') this.setStatus({ state: 'loading', loaded: reply.loaded, total: reply.total });
        else if (reply.type === 'ready') {
          console.info(`[ai] embedding model ready in ${Math.round(reply.ms)} ms`);
          resolve();
        } else if (reply.type === 'vectors') {
          this.pending.get(reply.id)?.resolve(reply.vectors);
          this.pending.delete(reply.id);
        } else if (reply.type === 'error') {
          if (reply.id === undefined) reject(new Error(reply.message));
          else {
            this.pending.get(reply.id)?.reject(new Error(reply.message));
            this.pending.delete(reply.id);
          }
        }
      });
      worker.addEventListener('error', (event) => reject(new Error(event.message || '임베딩 모델을 시작하지 못했어요.')));
    });
    this.ready.catch((error: Error) => {
      this.stop();
      this.setStatus({ state: 'error', message: error.message });
    });
    this.setStatus({ state: 'loading', loaded: 0, total: EMBEDDING_MODEL.bytes });
    worker.postMessage({ type: 'load', model: EMBEDDING_MODEL } satisfies EmbedRequest);
    return this.ready;
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    for (const waiting of this.pending.values()) waiting.reject(new Error('임베딩 작업이 멈췄어요.'));
    this.pending.clear();
  }

  private embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type: 'embed', id, texts, kind } satisfies EmbedRequest);
    });
  }

  private async state(): Promise<IndexState> {
    const saved = await this.store.getSetting<IndexState>(INDEX_KEY);
    return saved && saved.model === INDEX_VERSION ? saved : { model: INDEX_VERSION, records: {} };
  }

  async restore(records: CallRecord[]): Promise<void> {
    if (!(await this.isEnabled())) return;
    const live = new Set(records.map((r) => r.id));
    this.chunks = (await this.store.listChunks()).filter((c) => live.has(c.recordId) && c.model === EMBEDDING_MODEL.id);
    const state = await this.state();
    const stale = records.some((r) => state.records[r.id] !== r.updatedAt);
    if (stale) void this.sync(records).catch(() => undefined);
    else this.setStatus({ state: 'ready', chunks: this.chunks.length });
  }

  /** Embeds every call whose text changed since it was last indexed and forgets calls that no longer exist. */
  sync(records: CallRecord[]): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      await this.start();
      const state = await this.state();
      const todo = records.filter((r) => state.records[r.id] !== r.updatedAt);
      this.setStatus({ state: 'indexing', done: 0, total: todo.length });
      for (const [i, record] of todo.entries()) {
        const pieces = chunkText(record.text);
        const vectors = pieces.length > 0 ? await this.embed(pieces.map((p) => embeddingText(p.text)), 'passage') : [];
        await this.store.replaceChunks(
          record.id,
          pieces.map((p, j) => ({ id: `${record.id}:${p.index}`, recordId: record.id, index: p.index, start: p.start, end: p.end, text: p.text, model: EMBEDDING_MODEL.id, vector: vectors[j]! })),
        );
        state.records[record.id] = record.updatedAt;
        await this.store.setSetting(INDEX_KEY, state);
        this.setStatus({ state: 'indexing', done: i + 1, total: todo.length });
      }
      const live = new Set(records.map((r) => r.id));
      for (const id of Object.keys(state.records)) if (!live.has(id)) delete state.records[id];
      await this.store.setSetting(INDEX_KEY, state);
      this.chunks = (await this.store.listChunks()).filter((c) => live.has(c.recordId) && c.model === EMBEDDING_MODEL.id);
      this.setStatus({ state: 'ready', chunks: this.chunks.length });
    })().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  async queryVector(text: string): Promise<Float32Array> {
    await this.start();
    const [vector] = await this.embed([embeddingText(text)], 'query');
    return vector!;
  }
}

export type ChatStatus =
  | { state: 'idle' }
  | { state: 'loading'; loaded: number; total: number }
  | { state: 'ready' }
  | { state: 'error'; message: string };

export interface Support {
  ok: boolean;
  reason: string;
}

interface GpuAdapterLike {
  features: { has(name: string): boolean };
}

export class ChatEngine {
  status: ChatStatus = { state: 'idle' };
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private loadedModel: string | null = null;
  private nextId = 1;
  private readonly streams = new Map<number, { onToken: (text: string) => void; resolve: (text: string) => void; reject: (error: Error) => void }>();

  constructor(private readonly changed: () => void) {}

  /** WebGPU with 16-bit shaders and at least 4 GB of reported device memory; otherwise the reason in Korean. */
  async support(): Promise<Support> {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<GpuAdapterLike | null> }; deviceMemory?: number };
    if (!nav.gpu) return { ok: false, reason: '이 브라우저에서는 WebGPU를 쓸 수 없어요.' };
    const adapter = await nav.gpu.requestAdapter().catch(() => null);
    if (!adapter) return { ok: false, reason: '이 기기에서 쓸 수 있는 GPU(WebGPU)를 찾지 못했어요.' };
    if (!adapter.features.has('shader-f16')) return { ok: false, reason: '이 기기의 GPU가 16비트 연산(shader-f16)을 지원하지 않아요.' };
    if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return { ok: false, reason: `이 기기의 메모리(${nav.deviceMemory}GB)로는 큰 AI 모델을 돌리기 어려워요.` };
    return { ok: true, reason: '' };
  }

  private setStatus(status: ChatStatus): void {
    this.status = status;
    this.changed();
  }

  start(model: ModelChoice): Promise<void> {
    if (this.ready && this.loadedModel === model.id) return this.ready;
    this.stop();
    const worker = new Worker(new URL('llm-worker.js', document.baseURI), { type: 'module', name: 'llm' });
    this.worker = worker;
    this.loadedModel = model.id;
    this.ready = new Promise<void>((resolve, reject) => {
      worker.addEventListener('message', (event: MessageEvent<LlmReply>) => {
        const reply = event.data;
        if (reply.type === 'progress') this.setStatus({ state: 'loading', loaded: reply.loaded, total: reply.total });
        else if (reply.type === 'ready') {
          console.info(`[ai] chat model ready in ${Math.round(reply.ms)} ms`);
          this.setStatus({ state: 'ready' });
          resolve();
        } else if (reply.type === 'token') this.streams.get(reply.id)?.onToken(reply.text);
        else if (reply.type === 'done') {
          this.streams.get(reply.id)?.resolve(reply.text);
          this.streams.delete(reply.id);
        } else if (reply.type === 'error') {
          if (reply.id === undefined) reject(new Error(reply.message));
          else {
            this.streams.get(reply.id)?.reject(new Error(reply.message));
            this.streams.delete(reply.id);
          }
        }
      });
      worker.addEventListener('error', (event) => reject(new Error(event.message || 'AI 답변 모델을 시작하지 못했어요.')));
    });
    this.ready.catch((error: Error) => {
      this.stop();
      this.setStatus({ state: 'error', message: error.message });
    });
    this.setStatus({ state: 'loading', loaded: 0, total: model.bytes });
    worker.postMessage({ type: 'load', model } satisfies LlmRequest);
    return this.ready;
  }

  generate(messages: ChatMessage[], onToken: (text: string) => void): Promise<string> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('AI 답변 모델이 준비되지 않았어요.'));
        return;
      }
      this.streams.set(id, { onToken, resolve, reject });
      this.worker.postMessage({ type: 'generate', id, messages, maxNewTokens: 400 } satisfies LlmRequest);
    });
  }

  interrupt(): void {
    this.worker?.postMessage({ type: 'interrupt' } satisfies LlmRequest);
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.loadedModel = null;
    for (const stream of this.streams.values()) stream.reject(new Error('AI 답변이 멈췄어요.'));
    this.streams.clear();
    if (this.status.state !== 'error') this.status = { state: 'idle' };
  }
}

export function chatModel(id: string | undefined): ModelChoice {
  return CHAT_MODELS.find((m) => m.id === id) ?? CHAT_MODELS[0]!;
}
