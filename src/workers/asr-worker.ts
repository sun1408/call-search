import type { AsrReply, AsrRequest } from '../core/asr-protocol';
import type { Segment } from '../core/types';

interface ModuleConfig {
  $ww?: boolean;
  locateFile?: (path: string) => string;
  onRuntimeInitialized?: () => void;
  onAbort?: (what: unknown) => void;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}

interface EmscriptenModule extends ModuleConfig {
  FS_createDataFile(parent: string, name: string, data: Uint8Array, canRead: boolean, canWrite: boolean, canOwn: boolean): void;
  FS_unlink(path: string): void;
}

interface SpeechSegment {
  samples: Float32Array;
  start: number;
}

interface VadInstance {
  acceptWaveform(samples: Float32Array): void;
  isEmpty(): boolean;
  front(): SpeechSegment;
  pop(): void;
  flush(): void;
  reset(): void;
}

interface OfflineStreamInstance {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  free(): void;
}

interface OfflineRecognizerInstance {
  handle: number;
  createStream(): OfflineStreamInstance;
  decode(stream: OfflineStreamInstance): void;
  getResult(stream: OfflineStreamInstance): { text: string };
}

declare const self: DedicatedWorkerGlobalScope & { Module: ModuleConfig };
declare const OfflineRecognizer: new (config: unknown, module: EmscriptenModule) => OfflineRecognizerInstance;
declare function createVad(module: EmscriptenModule, config: unknown): VadInstance;

const VENDOR = new URL('vendor/sherpa-onnx-9d5fc71/', self.location.href).href;
const SAMPLE_RATE = 16_000;
const WINDOW = 512;

let recognizer: OfflineRecognizerInstance | null = null;
let vad: VadInstance | null = null;

const post = (reply: AsrReply) => self.postMessage(reply);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function hasFileSystem(module: ModuleConfig): module is EmscriptenModule {
  const runtime = module as Partial<EmscriptenModule>;
  return typeof runtime.FS_createDataFile === 'function' && typeof runtime.FS_unlink === 'function';
}

function loadRuntime(): Promise<EmscriptenModule> {
  return new Promise((resolve, reject) => {
    const module: ModuleConfig = {
      // Truthy $ww makes the glue skip its bundled .data package; the model files are written into its FS below.
      $ww: true,
      locateFile: (path) => VENDOR + path,
      onRuntimeInitialized: () => (hasFileSystem(module) ? resolve(module) : reject(new Error('음성 인식 엔진의 파일 기능을 찾지 못했어요.'))),
      onAbort: (what) => reject(new Error(`음성 인식 엔진을 시작하지 못했어요: ${String(what)}`)),
      print: () => undefined,
      printErr: (text) => console.warn('[sherpa-onnx]', text),
    };
    self.Module = module;
    importScripts(`${VENDOR}sherpa-onnx-wasm-main-vad-asr.js`, `${VENDOR}sherpa-onnx-asr.js`, `${VENDOR}sherpa-onnx-vad.js`);
  });
}

async function bytes(response: Response | undefined, what: string): Promise<Uint8Array> {
  if (!response || !response.ok) throw new Error(`${what} 파일이 없어요. 설정에서 모델을 다시 내려받아 주세요.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function init(request: Extract<AsrRequest, { type: 'init' }>): Promise<void> {
  const started = performance.now();
  const module = await loadRuntime();
  const cache = await caches.open(request.cache);
  module.FS_createDataFile('/', 'sense-voice.onnx', await bytes(await cache.match(request.modelUrl), '음성 인식 모델'), true, false, true);
  module.FS_createDataFile('/', 'tokens.txt', await bytes(await cache.match(request.tokensUrl), '음성 인식 단어'), true, false, true);
  module.FS_createDataFile('/', 'silero_vad.onnx', await bytes(await fetch(`${VENDOR}silero_vad.onnx`), '말소리 감지'), true, false, true);
  recognizer = new OfflineRecognizer(
    {
      modelConfig: {
        debug: 0,
        numThreads: 1,
        provider: 'cpu',
        tokens: './tokens.txt',
        senseVoice: { model: './sense-voice.onnx', language: request.language, useInverseTextNormalization: 1 },
      },
    },
    module,
  );
  if (!recognizer.handle) throw new Error('음성 인식 모델을 열지 못했어요. 모델을 지우고 다시 내려받아 주세요.');
  const silero = { model: './silero_vad.onnx', threshold: 0.5, minSilenceDuration: 0.5, minSpeechDuration: 0.25, maxSpeechDuration: 20, windowSize: WINDOW };
  vad = createVad(module, {
    sileroVad: silero,
    tenVad: { ...silero, model: '', windowSize: 256 },
    sampleRate: SAMPLE_RATE,
    numThreads: 1,
    provider: 'cpu',
    debug: 0,
    bufferSizeInSeconds: 60,
  });
  module.FS_unlink('/sense-voice.onnx');
  post({ type: 'ready', ms: performance.now() - started });
}

function transcribe(id: number, samples: Float32Array): void {
  if (!recognizer || !vad) throw new Error('음성 인식 엔진이 아직 준비되지 않았어요.');
  const started = performance.now();
  const engine = recognizer;
  const detector = vad;
  const segments: Segment[] = [];
  const drain = () => {
    while (!detector.isEmpty()) {
      const speech = detector.front();
      detector.pop();
      const stream = engine.createStream();
      stream.acceptWaveform(SAMPLE_RATE, speech.samples);
      engine.decode(stream);
      const text = engine.getResult(stream).text.replace(/\s+/g, ' ').trim();
      stream.free();
      if (text) segments.push({ start: speech.start / SAMPLE_RATE, end: (speech.start + speech.samples.length) / SAMPLE_RATE, text });
    }
  };
  detector.reset();
  let lastPost = 0;
  const window = new Float32Array(WINDOW);
  for (let offset = 0; offset < samples.length; offset += WINDOW) {
    const end = Math.min(offset + WINDOW, samples.length);
    window.fill(0);
    window.set(samples.subarray(offset, end));
    detector.acceptWaveform(window);
    drain();
    const now = performance.now();
    if (now - lastPost > 250) {
      lastPost = now;
      post({ type: 'progress', id, done: end, total: samples.length });
    }
  }
  detector.flush();
  drain();
  post({ type: 'progress', id, done: samples.length, total: samples.length });
  post({ type: 'result', id, segments, ms: performance.now() - started });
}

self.addEventListener('message', (event: MessageEvent<AsrRequest>) => {
  const request = event.data;
  if (request.type === 'init') {
    init(request).catch((error) => post({ type: 'error', message: message(error) }));
  } else if (request.type === 'transcribe') {
    try {
      transcribe(request.id, request.samples);
    } catch (error) {
      post({ type: 'error', id: request.id, message: message(error) });
    }
  }
});
