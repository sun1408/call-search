export interface Tensor {
  data: Float32Array;
  dims: number[];
  tolist(): unknown;
  slice(...ranges: Array<Array<number | null> | number | null>): Tensor;
}

export interface ProgressInfo {
  status: string;
  loaded?: number;
  total?: number;
}

export type ProgressCallback = (info: ProgressInfo) => void;

export interface FeatureExtractor {
  (texts: string[], options: { pooling: 'mean'; normalize: boolean }): Promise<Tensor>;
}

export interface SpeechRecognizer {
  (audio: Float32Array, options: Record<string, unknown>): Promise<{ text: string }>;
}

export interface Tokenizer {
  apply_chat_template(messages: unknown[], options: Record<string, unknown>): { input_ids: Tensor; attention_mask: Tensor };
  batch_decode(tokens: Tensor, options: Record<string, unknown>): string[];
}

export interface CausalLM {
  generate(options: Record<string, unknown>): Promise<{ sequences: Tensor }>;
}

export interface StoppingCriteria {
  interrupt(): void;
  reset(): void;
}

export interface TransformersModule {
  env: {
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
    useBrowserCache: boolean;
    useWasmCache: boolean;
    backends: { onnx: { wasm: { wasmPaths?: { mjs: string; wasm: string }; proxy?: boolean; numThreads?: number } } };
  };
  pipeline(task: 'feature-extraction', model: string, options: Record<string, unknown>): Promise<FeatureExtractor>;
  pipeline(task: 'automatic-speech-recognition', model: string, options: Record<string, unknown>): Promise<SpeechRecognizer>;
  AutoTokenizer: { from_pretrained(id: string, options: Record<string, unknown>): Promise<Tokenizer> };
  AutoModelForCausalLM: { from_pretrained(id: string, options: Record<string, unknown>): Promise<CausalLM> };
  TextStreamer: new (tokenizer: Tokenizer, options: Record<string, unknown>) => unknown;
  InterruptableStoppingCriteria: new () => StoppingCriteria;
}

const BASE = new URL('vendor/transformers-4.3.1/', self.location.href).href;

/** Loads the self-hosted Transformers.js build and points ONNX Runtime at the self-hosted wasm, so no CDN is contacted. */
export async function loadTransformers(): Promise<TransformersModule> {
  const library = (await import(`${BASE}transformers.min.js`)) as TransformersModule;
  library.env.allowLocalModels = false;
  library.env.allowRemoteModels = true;
  library.env.useBrowserCache = true;
  library.env.useWasmCache = false;
  library.env.backends.onnx.wasm.wasmPaths = { mjs: `${BASE}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${BASE}ort-wasm-simd-threaded.asyncify.wasm` };
  library.env.backends.onnx.wasm.proxy = false;
  return library;
}

export function progressReporter(post: (loaded: number, total: number) => void): ProgressCallback {
  return (info) => {
    if (info.status === 'progress_total' && typeof info.loaded === 'number' && typeof info.total === 'number') post(info.loaded, info.total);
  };
}
