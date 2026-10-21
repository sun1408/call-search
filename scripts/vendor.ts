// Re-downloads the pinned third-party runtime files into public/vendor/ and verifies their sha256.
// Run: bun run scripts/vendor.ts            (fails on any hash mismatch)
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

const SPACE = 'https://huggingface.co/spaces/k2-fsa/web-assembly-vad-asr-sherpa-onnx-zh-zipformer-ctc/resolve/9d5fc71d88ab1222ed1af2274fb194592af48455/';
const SHERPA = 'public/vendor/sherpa-onnx-9d5fc71';
const TRANSFORMERS = 'public/vendor/transformers-4.3.1';

const FILES = [
  { url: `${SPACE}sherpa-onnx-wasm-main-vad-asr.js`, to: `${SHERPA}/sherpa-onnx-wasm-main-vad-asr.js`, sha256: '8a7f50a3e4e5930749e8aff9ad98f03753b87490e7796c576947611439dae9d0' },
  { url: `${SPACE}sherpa-onnx-wasm-main-vad-asr.wasm`, to: `${SHERPA}/sherpa-onnx-wasm-main-vad-asr.wasm`, sha256: 'e4dead1d159c531282e635069fa9e028175dee71f3f90908186994655425b3ce' },
  { url: `${SPACE}sherpa-onnx-asr.js`, to: `${SHERPA}/sherpa-onnx-asr.js`, sha256: '6297ed7520e0b4569486cd89be89045146728605418254fec4172194abc36c8d' },
  { url: `${SPACE}sherpa-onnx-vad.js`, to: `${SHERPA}/sherpa-onnx-vad.js`, sha256: 'ca2b0844d1cfd375cbb7faba206e456c5140561578b67f5fc6e7510d09e75510' },
  { url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx', to: `${SHERPA}/silero_vad.onnx`, sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6' },
  { url: 'https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/master/LICENSE', to: `${SHERPA}/LICENSE-sherpa-onnx`, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' },
  { url: 'https://raw.githubusercontent.com/snakers4/silero-vad/master/LICENSE', to: `${SHERPA}/LICENSE-silero-vad`, sha256: '2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b' },
  { url: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js', to: `${TRANSFORMERS}/transformers.min.js`, sha256: '8d6716d9086f57c30a4bf367dba61b887593573c770c454465e8019b2703e743' },
  { url: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/LICENSE', to: `${TRANSFORMERS}/LICENSE-transformers`, sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' },
  { url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded.asyncify.mjs', to: `${TRANSFORMERS}/ort-wasm-simd-threaded.asyncify.mjs`, sha256: '0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611' },
  { url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/ort-wasm-simd-threaded.asyncify.wasm', to: `${TRANSFORMERS}/ort-wasm-simd-threaded.asyncify.wasm`, sha256: '49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082' },
  { url: 'https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE', to: `${TRANSFORMERS}/LICENSE-onnxruntime`, sha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c' },
];

let failed = false;
for (const file of FILES) {
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`${file.url}: HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(data).digest('hex');
  if (sha256 !== file.sha256) {
    console.error(`MISMATCH ${file.to}: got ${sha256}`);
    failed = true;
    continue;
  }
  await mkdir(file.to.slice(0, file.to.lastIndexOf('/')), { recursive: true });
  await Bun.write(file.to, data);
  console.log(`ok ${file.to} ${data.length} bytes`);
}
if (failed) process.exit(1);
