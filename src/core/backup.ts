import { cleanText } from './text';
import type { CallRecord, DateSource, Segment } from './types';

export const BACKUP_FORMAT = 'call-search-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  records: CallRecord[];
}

export class BackupError extends Error {}

export function makeBackup(records: CallRecord[], now: Date): Backup {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), records };
}

type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const DATE_SOURCES: readonly DateSource[] = ['filename', 'file', 'manual', 'now'];

function toSegment(v: unknown): Segment | null {
  if (!isObject(v) || !finite(v.start) || !finite(v.end) || typeof v.text !== 'string') return null;
  return { start: v.start, end: v.end, text: v.text };
}

function toRecord(v: unknown): CallRecord | null {
  if (!isObject(v)) return null;
  const { id, text, date } = v;
  if (typeof id !== 'string' || id === '' || typeof text !== 'string' || !finite(date)) return null;
  const record: CallRecord = {
    id,
    source: v.source === 'audio' ? 'audio' : 'text',
    contact: typeof v.contact === 'string' ? v.contact.normalize('NFC').trim() : '',
    number: typeof v.number === 'string' ? v.number.trim() : '',
    date,
    dateSource: DATE_SOURCES.includes(v.dateSource as DateSource) ? (v.dateSource as DateSource) : 'manual',
    text: cleanText(text),
    createdAt: finite(v.createdAt) ? v.createdAt : date,
    updatedAt: finite(v.updatedAt) ? v.updatedAt : date,
  };
  if (finite(v.durationSec)) record.durationSec = v.durationSec;
  if (typeof v.fileName === 'string') record.fileName = v.fileName;
  if (typeof v.engine === 'string') record.engine = v.engine;
  if (Array.isArray(v.segments)) {
    const segments = v.segments.map(toSegment).filter((s): s is Segment => s !== null);
    if (segments.length > 0) record.segments = segments;
  }
  return record;
}

export function parseBackup(raw: unknown): { records: CallRecord[]; rejected: number } {
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT || !finite(raw.version) || !Array.isArray(raw.records)) {
    throw new BackupError('통화 검색 백업 파일이 아닙니다.');
  }
  if (raw.version > BACKUP_VERSION) throw new BackupError('더 새 버전의 앱에서 만든 백업입니다. 앱을 새로 고친 뒤 다시 시도해 주세요.');
  const records: CallRecord[] = [];
  let rejected = 0;
  for (const item of raw.records) {
    const record = toRecord(item);
    if (record) records.push(record);
    else rejected++;
  }
  return { records, rejected };
}

export interface MergePlan {
  toPut: CallRecord[];
  added: number;
  updated: number;
  unchanged: number;
}

/** Records new to this device are added; a record already here is replaced only by a newer edit. */
export function planMerge(existing: CallRecord[], incoming: CallRecord[]): MergePlan {
  const current = new Map(existing.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const plan: MergePlan = { toPut: [], added: 0, updated: 0, unchanged: 0 };
  for (const record of incoming) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    const here = current.get(record.id);
    if (!here) {
      plan.toPut.push(record);
      plan.added++;
    } else if (record.updatedAt > here.updatedAt) {
      plan.toPut.push(record);
      plan.updated++;
    } else {
      plan.unchanged++;
    }
  }
  return plan;
}
