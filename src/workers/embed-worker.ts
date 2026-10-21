import type { EmbedReply, EmbedRequest } from '../core/ai-protocol';
import { loadTransformers, progressReporter, type FeatureExtractor } from './tjs';

declare const self: DedicatedWorkerGlobalScope;

let extractor: FeatureExtractor | null = null;
const post = (reply: EmbedReply, transfer: Transferable[] = []) => self.postMessage(reply, transfer);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const BATCH = 8;

async function load(request: Extract<EmbedRequest, { type: 'load' }>): Promise<void> {
  const started = performance.now();
  const library = await loadTransformers();
  extractor = await library.pipeline('feature-extraction', request.model.id, {
    revision: request.model.revision,
    dtype: request.model.dtype,
    device: 'wasm',
    progress_callback: progressReporter((loaded, total) => post({ type: 'progress', loaded, total })),
  });
  post({ type: 'ready', ms: performance.now() - started });
}

async function embed(request: Extract<EmbedRequest, { type: 'embed' }>): Promise<void> {
  if (!extractor) throw new Error('임베딩 모델이 아직 준비되지 않았어요.');
  const prefix = request.kind === 'query' ? 'query: ' : 'passage: ';
  const vectors: Float32Array[] = [];
  for (let i = 0; i < request.texts.length; i += BATCH) {
    const batch = request.texts.slice(i, i + BATCH).map((t) => prefix + t);
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    const width = output.dims[output.dims.length - 1]!;
    for (let row = 0; row < batch.length; row++) vectors.push(output.data.slice(row * width, (row + 1) * width));
  }
  post({ type: 'vectors', id: request.id, vectors }, vectors.map((v) => v.buffer));
}

self.addEventListener('message', (event: MessageEvent<EmbedRequest>) => {
  const request = event.data;
  if (request.type === 'load') load(request).catch((error) => post({ type: 'error', message: message(error) }));
  else if (request.type === 'embed') embed(request).catch((error) => post({ type: 'error', id: request.id, message: message(error) }));
});
