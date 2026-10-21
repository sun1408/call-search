import type { AudioPiece } from './audio-split';
import type { ChatMessage } from './prompt';
import type { Segment } from './types';

export interface ModelChoice {
  id: string;
  revision: string;
  dtype: string | Record<string, string>;
  label: string;
  bytes: number;
  device?: 'webgpu' | 'wasm';
}

export const WHISPER_MODEL: ModelChoice = {
  id: 'onnx-community/whisper-large-v3-turbo',
  revision: '360ebcde2559d60bb474678be3c1de9ef347d01a',
  dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' },
  label: 'Whisper large-v3-turbo',
  bytes: 765_000_000,
  device: 'webgpu',
};

export type WhisperRequest =
  | { type: 'load'; model: ModelChoice }
  | { type: 'transcribe'; id: number; samples: Float32Array; pieces: AudioPiece[]; sampleRate: number };

export type WhisperReply =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; ms: number }
  | { type: 'piece'; id: number; done: number; total: number }
  | { type: 'result'; id: number; segments: Segment[]; ms: number }
  | { type: 'error'; id?: number; message: string };

export const EMBEDDING_MODEL: ModelChoice = {
  id: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  dtype: 'q8',
  label: 'multilingual-e5-small',
  bytes: 135_000_000,
};

export const CHAT_MODELS: ModelChoice[] = [
  { id: 'onnx-community/EXAONE-3.5-2.4B-Instruct', revision: '52dafcd7ced520b57c5528585b1bbf60af7aa439', dtype: 'q4f16', label: 'EXAONE 3.5 2.4B (한국어 특화)', bytes: 1_745_000_000 },
  { id: 'onnx-community/Qwen2.5-1.5B-Instruct', revision: 'd54957e3af1be04546436e874a60fe386041b244', dtype: 'q4f16', label: 'Qwen2.5 1.5B (가벼움)', bytes: 1_235_000_000 },
];

export type EmbedRequest =
  | { type: 'load'; model: ModelChoice }
  | { type: 'embed'; id: number; texts: string[]; kind: 'query' | 'passage' };

export type EmbedReply =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; ms: number }
  | { type: 'vectors'; id: number; vectors: Float32Array[] }
  | { type: 'error'; id?: number; message: string };

export type LlmRequest =
  | { type: 'probe' }
  | { type: 'load'; model: ModelChoice }
  | { type: 'generate'; id: number; messages: ChatMessage[]; maxNewTokens: number }
  | { type: 'interrupt' };

export type LlmReply =
  | { type: 'probe'; webgpu: boolean; f16: boolean; reason: string }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; ms: number }
  | { type: 'token'; id: number; text: string }
  | { type: 'done'; id: number; text: string; ms: number }
  | { type: 'error'; id?: number; message: string };
