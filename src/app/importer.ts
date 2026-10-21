import { parseRecordingName, resolveCallTime } from '../core/filename';
import type { Store } from '../core/store';
import type { CallRecord, InboxItem, Segment } from '../core/types';

export type Stage = 'queued' | 'transcribing' | 'saving' | 'done' | 'error';

export interface QueueEntry {
  id: string;
  name: string;
  kind: 'audio' | 'text';
  stage: Stage;
  progress: number;
  detail: string;
  recordId?: string;
}

export interface Transcript {
  text: string;
  segments: Segment[];
  durationSec: number;
  engine: string;
}

export interface Transcriber {
  /** Resolves false when the user declines the one-time model download. */
  prepare(onProgress: (fraction: number, detail: string) => void): Promise<boolean>;
  transcribe(audio: Blob, onProgress: (fraction: number, detail: string) => void): Promise<Transcript>;
  idle?(): void;
}

export interface ImporterHooks {
  changed(): void;
  recordAdded(record: CallRecord): void;
  /** Lets the user confirm or edit shared text before it becomes a record. */
  reviewText(item: InboxItem): Promise<void>;
}

export const AUDIO_ACCEPT = 'audio/*,.m4a,.mp3,.aac,.wav,.amr,.3gp,.ogg,.opus,.flac';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Importer {
  readonly entries = new Map<string, QueueEntry>();
  private running = false;

  constructor(
    private readonly store: Store,
    private readonly transcriber: Transcriber,
    private readonly hooks: ImporterHooks,
  ) {}

  get busy(): boolean {
    return this.running;
  }

  async load(): Promise<void> {
    for (const item of await this.store.listInbox()) {
      if (!this.entries.has(item.id)) {
        this.entries.set(item.id, { id: item.id, name: item.name, kind: item.kind, stage: 'queued', progress: 0, detail: '대기 중' });
      }
    }
    this.hooks.changed();
  }

  async addFiles(files: File[]): Promise<void> {
    for (const file of files) {
      await this.store.addInbox({ kind: 'audio', name: file.name, type: file.type, lastModified: file.lastModified, blob: file });
    }
    await this.run();
  }

  async retry(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry) Object.assign(entry, { stage: 'queued', progress: 0, detail: '대기 중' });
    this.hooks.changed();
    await this.run();
  }

  async remove(id: string): Promise<void> {
    await this.store.deleteInbox(id);
    this.entries.delete(id);
    this.hooks.changed();
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const inbox = await this.store.listInbox();
        for (const item of inbox) {
          if (!this.entries.has(item.id)) {
            this.entries.set(item.id, { id: item.id, name: item.name, kind: item.kind, stage: 'queued', progress: 0, detail: '대기 중' });
          }
        }
        this.hooks.changed();
        const next = inbox.find((item) => this.entries.get(item.id)?.stage === 'queued');
        if (!next) break;
        await this.process(next);
      }
    } finally {
      this.running = false;
      this.transcriber.idle?.();
      this.hooks.changed();
    }
  }

  private async process(item: InboxItem): Promise<void> {
    const entry = this.entries.get(item.id)!;
    const update = (patch: Partial<QueueEntry>) => {
      Object.assign(entry, patch);
      this.hooks.changed();
    };
    try {
      if (item.kind === 'text') {
        update({ stage: 'saving', detail: '내용 확인 중' });
        await this.hooks.reviewText(item);
        await this.store.deleteInbox(item.id);
        update({ stage: 'done', progress: 1, detail: '완료' });
        return;
      }
      if (!item.blob) throw new Error('파일 내용을 읽지 못했어요.');
      update({ stage: 'transcribing', progress: 0, detail: '음성 인식 준비 중' });
      if (!(await this.transcriber.prepare((fraction, detail) => update({ progress: fraction, detail })))) {
        update({ stage: 'error', detail: '음성 인식 모델을 내려받아야 글로 바꿀 수 있어요.' });
        return;
      }
      const result = await this.transcriber.transcribe(item.blob, (fraction, detail) => update({ progress: fraction, detail }));
      if (!result.text.trim()) throw new Error('말소리를 찾지 못했어요.');
      update({ stage: 'saving', progress: 1, detail: '저장 중' });
      const parsed = parseRecordingName(item.name);
      const when = resolveCallTime(parsed, item.lastModified, Date.now());
      const record = await this.store.addRecord({
        source: 'audio',
        contact: parsed.contact,
        number: parsed.number,
        date: when.date,
        dateSource: when.source,
        durationSec: result.durationSec,
        text: result.text,
        segments: result.segments,
        fileName: item.name,
        engine: result.engine,
      });
      await this.store.deleteInbox(item.id);
      update({ stage: 'done', progress: 1, detail: '완료', recordId: record.id });
      this.hooks.recordAdded(record);
    } catch (error) {
      update({ stage: 'error', detail: message(error) });
    }
  }
}
