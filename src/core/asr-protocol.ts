import type { Segment } from './types';

export type AsrRequest =
  | { type: 'init'; cache: string; modelUrl: string; tokensUrl: string; language: string }
  | { type: 'transcribe'; id: number; samples: Float32Array };

export type AsrReply =
  | { type: 'ready'; ms: number }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; segments: Segment[]; ms: number }
  | { type: 'error'; id?: number; message: string };
