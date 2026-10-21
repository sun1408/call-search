export const MODEL_CACHE = 'cs-models-v1';

export interface ModelFile {
  url: string;
  bytes: number;
}

export interface ModelPack {
  id: string;
  name: string;
  files: ModelFile[];
  runtime: ModelFile[];
}

const SENSEVOICE_REPO = 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/';
export const SHERPA_DIR = 'vendor/sherpa-onnx-9d5fc71/';

export const SENSEVOICE: ModelPack = {
  id: 'sensevoice-int8-2024-07-17',
  name: 'SenseVoice Small (int8)',
  files: [
    { url: `${SENSEVOICE_REPO}model.int8.onnx`, bytes: 239_233_841 },
    { url: `${SENSEVOICE_REPO}tokens.txt`, bytes: 315_894 },
  ],
  runtime: [
    { url: `${SHERPA_DIR}sherpa-onnx-wasm-main-vad-asr.js`, bytes: 95_308 },
    { url: `${SHERPA_DIR}sherpa-onnx-wasm-main-vad-asr.wasm`, bytes: 11_722_172 },
    { url: `${SHERPA_DIR}sherpa-onnx-asr.js`, bytes: 47_391 },
    { url: `${SHERPA_DIR}sherpa-onnx-vad.js`, bytes: 7_764 },
    { url: `${SHERPA_DIR}silero_vad.onnx`, bytes: 643_854 },
  ],
};

export function packBytes(pack: ModelPack): number {
  return [...pack.files, ...pack.runtime].reduce((sum, file) => sum + file.bytes, 0);
}

export async function isPackCached(pack: ModelPack): Promise<boolean> {
  const cache = await caches.open(MODEL_CACHE);
  for (const file of pack.files) {
    if (!(await cache.match(file.url))) return false;
  }
  return true;
}

export async function removePack(pack: ModelPack): Promise<void> {
  const cache = await caches.open(MODEL_CACHE);
  for (const file of pack.files) await cache.delete(file.url);
}

/** Streams each model file into Cache Storage, checking the exact byte count, then warms the same-origin runtime for offline use. */
export async function downloadPack(pack: ModelPack, onProgress: (loaded: number, total: number) => void): Promise<void> {
  const cache = await caches.open(MODEL_CACHE);
  const total = packBytes(pack);
  let done = 0;
  for (const file of pack.files) {
    if (await cache.match(file.url)) {
      done += file.bytes;
      onProgress(done, total);
      continue;
    }
    const response = await fetch(file.url, { mode: 'cors', credentials: 'omit' });
    if (!response.ok || !response.body) throw new Error(`모델 파일을 받지 못했어요 (HTTP ${response.status}).`);
    let received = 0;
    const counted = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          onProgress(done + received, total);
          controller.enqueue(chunk);
        },
      }),
    );
    await cache.put(file.url, new Response(counted, { headers: { 'content-type': 'application/octet-stream' } }));
    if (received !== file.bytes) {
      await cache.delete(file.url);
      throw new Error('모델 파일이 끝까지 받아지지 않았어요. 연결을 확인하고 다시 시도해 주세요.');
    }
    done += file.bytes;
  }
  for (const file of pack.runtime) {
    const response = await fetch(new URL(file.url, document.baseURI));
    if (!response.ok) throw new Error(`음성 인식 엔진 파일을 받지 못했어요 (HTTP ${response.status}).`);
    await response.arrayBuffer();
    done += file.bytes;
    onProgress(done, total);
  }
}
