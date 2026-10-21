import type { LlmReply, LlmRequest } from '../core/ai-protocol';
import { loadTransformers, progressReporter, type CausalLM, type StoppingCriteria, type Tokenizer, type TransformersModule } from './tjs';

declare const self: DedicatedWorkerGlobalScope;

interface GpuAdapter {
  features: { has(name: string): boolean };
}

let library: TransformersModule | null = null;
let tokenizer: Tokenizer | null = null;
let model: CausalLM | null = null;
let stopping: StoppingCriteria | null = null;

const post = (reply: LlmReply) => self.postMessage(reply);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function probe(): Promise<void> {
  const gpu = (navigator as WorkerNavigator & { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } }).gpu;
  if (!gpu) {
    post({ type: 'probe', webgpu: false, f16: false, reason: '이 브라우저는 WebGPU를 지원하지 않아요.' });
    return;
  }
  const adapter = await gpu.requestAdapter().catch(() => null);
  if (!adapter) {
    post({ type: 'probe', webgpu: false, f16: false, reason: '이 기기에서 쓸 수 있는 GPU(WebGPU)를 찾지 못했어요.' });
    return;
  }
  const f16 = adapter.features.has('shader-f16');
  post({ type: 'probe', webgpu: true, f16, reason: f16 ? '' : '이 기기의 GPU가 16비트 연산(shader-f16)을 지원하지 않아요.' });
}

async function load(request: Extract<LlmRequest, { type: 'load' }>): Promise<void> {
  const started = performance.now();
  library ??= await loadTransformers();
  const progress_callback = progressReporter((loaded, total) => post({ type: 'progress', loaded, total }));
  const options = { revision: request.model.revision, progress_callback };
  tokenizer = await library.AutoTokenizer.from_pretrained(request.model.id, options);
  model = await library.AutoModelForCausalLM.from_pretrained(request.model.id, { ...options, dtype: request.model.dtype, device: 'webgpu' });
  stopping = new library.InterruptableStoppingCriteria();
  post({ type: 'ready', ms: performance.now() - started });
}

async function generate(request: Extract<LlmRequest, { type: 'generate' }>): Promise<void> {
  if (!library || !tokenizer || !model || !stopping) throw new Error('AI 답변 모델이 아직 준비되지 않았어요.');
  const started = performance.now();
  const inputs = tokenizer.apply_chat_template(request.messages, { add_generation_prompt: true, return_dict: true, enable_thinking: false });
  const streamer = new library.TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text: string) => post({ type: 'token', id: request.id, text }),
  });
  stopping.reset();
  const output = await model.generate({
    ...inputs,
    max_new_tokens: request.maxNewTokens,
    do_sample: false,
    repetition_penalty: 1.1,
    streamer,
    stopping_criteria: stopping,
    return_dict_in_generate: true,
  });
  const promptLength = inputs.input_ids.dims[inputs.input_ids.dims.length - 1]!;
  const [text] = tokenizer.batch_decode(output.sequences.slice(null, [promptLength, null]), { skip_special_tokens: true });
  post({ type: 'done', id: request.id, text: text ?? '', ms: performance.now() - started });
}

self.addEventListener('message', (event: MessageEvent<LlmRequest>) => {
  const request = event.data;
  if (request.type === 'probe') probe().catch((error) => post({ type: 'probe', webgpu: false, f16: false, reason: message(error) }));
  else if (request.type === 'load') load(request).catch((error) => post({ type: 'error', message: message(error) }));
  else if (request.type === 'generate') generate(request).catch((error) => post({ type: 'error', id: request.id, message: message(error) }));
  else if (request.type === 'interrupt') stopping?.interrupt();
});
