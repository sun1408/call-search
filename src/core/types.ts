export type RecordSource = 'audio' | 'text';

export type DateSource = 'filename' | 'file' | 'manual' | 'now';

/** One recognized stretch of speech, times in seconds from the start of the call. */
export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface CallRecord {
  id: string;
  source: RecordSource;
  /** Contact name, '' when unknown. */
  contact: string;
  /** Phone number, digits only (see normalizeNumber), '' when unknown. */
  number: string;
  /** Call start, epoch milliseconds. */
  date: number;
  dateSource: DateSource;
  durationSec?: number;
  /** Full transcript, NFC-normalized. */
  text: string;
  segments?: Segment[];
  fileName?: string;
  /** Speech-recognition engine that produced the text, or 'text' for pasted text. */
  engine?: string;
  createdAt: number;
  updatedAt: number;
}

export type NewRecord = Omit<CallRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

export type RecordPatch = Partial<Pick<CallRecord, 'contact' | 'number' | 'date' | 'dateSource' | 'text'>>;

/** A shared or picked item waiting to be turned into a record. Audio is deleted once transcribed. */
export interface InboxItem {
  id: string;
  kind: 'audio' | 'text';
  name: string;
  type: string;
  lastModified: number;
  blob?: Blob;
  text?: string;
  title?: string;
  receivedAt: number;
}

export interface Chunk {
  /** `${recordId}:${index}` */
  id: string;
  recordId: string;
  index: number;
  /** Character offsets into the record text. */
  start: number;
  end: number;
  text: string;
  model: string;
  vector: Float32Array;
}
