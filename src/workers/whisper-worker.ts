import type { WhisperReply, WhisperRequest } from '../core/ai-protocol';
import type { Segment } from '../core/types';
import { loadTransformers, progressReporter, type SpeechRecognizer } from './tjs';

declare const self: DedicatedWorkerGlobalScope;

let recognizer: SpeechRecognizer | null = null;
const post = (reply: WhisperReply) => self.postMessage(reply);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function load(request: Extract<WhisperRequest, { type: 'load' }>): Promise<void> {
  const started = performance.now();
  const library = await loadTransformers();
  recognizer = await library.pipeline('automatic-speech-recognition', request.model.id, {
    revision: request.model.revision,
    dtype: request.model.dtype,
    device: request.model.device ?? 'webgpu',
    progress_callback: progressReporter((loaded, total) => post({ type: 'progress', loaded, total })),
  });
  post({ type: 'ready', ms: performance.now() - started });
}

async function transcribe(request: Extract<WhisperRequest, { type: 'transcribe' }>): Promise<void> {
  if (!recognizer) throw new Error('Whisper 모델이 아직 준비되지 않았어요.');
  const started = performance.now();
  const segments: Segment[] = [];
  for (const [i, piece] of request.pieces.entries()) {
    if (!piece.silent) {
      const output = await recognizer(request.samples.subarray(piece.start, piece.end), { language: 'korean', task: 'transcribe' });
      const text = output.text.replace(/\s+/g, ' ').trim();
      if (text) segments.push({ start: piece.start / request.sampleRate, end: piece.end / request.sampleRate, text });
    }
    post({ type: 'piece', id: request.id, done: i + 1, total: request.pieces.length });
  }
  post({ type: 'result', id: request.id, segments, ms: performance.now() - started });
}

self.addEventListener('message', (event: MessageEvent<WhisperRequest>) => {
  const request = event.data;
  if (request.type === 'load') load(request).catch((error) => post({ type: 'error', message: message(error) }));
  else if (request.type === 'transcribe') transcribe(request).catch((error) => post({ type: 'error', id: request.id, message: message(error) }));
});
