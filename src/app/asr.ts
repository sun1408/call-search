import type { Transcriber, Transcript } from './importer';

export class PendingTranscriber implements Transcriber {
  async prepare(): Promise<boolean> {
    return true;
  }

  async transcribe(): Promise<Transcript> {
    throw new Error('음성 인식 엔진을 준비하고 있어요. 앱이 업데이트되면 다시 시도해 주세요.');
  }
}
