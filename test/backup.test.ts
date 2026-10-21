import { describe, expect, test } from 'bun:test';
import { BackupError, makeBackup, parseBackup, planMerge } from '../src/core/backup';
import type { CallRecord } from '../src/core/types';

const base: CallRecord = {
  id: 'r1',
  source: 'audio',
  contact: '김과장',
  number: '01012345678',
  date: 1_760_000_000_000,
  dateSource: 'filename',
  durationSec: 61.5,
  text: '내일 계약서 가져오세요.',
  segments: [{ start: 0.5, end: 3.25, text: '내일 계약서 가져오세요.' }],
  fileName: '01012345678_20251009084000.m4a',
  engine: 'sensevoice-int8-2024-07-17',
  createdAt: 1_760_000_100_000,
  updatedAt: 1_760_000_200_000,
};

describe('backup round trip', () => {
  test('export then import gives the same records', () => {
    const backup = makeBackup([base, { ...base, id: 'r2', source: 'text', segments: undefined }], new Date(Date.UTC(2026, 9, 21)));
    expect(backup.exportedAt).toBe('2026-10-21T00:00:00.000Z');
    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
    expect(parsed.rejected).toBe(0);
    expect(parsed.records[0]).toEqual(base);
    expect(parsed.records[1]!.id).toBe('r2');
    expect(parsed.records[1]!.segments).toBeUndefined();
  });
});

describe('parseBackup', () => {
  test('rejects files that are not backups', () => {
    expect(() => parseBackup({ records: [] })).toThrow(BackupError);
    expect(() => parseBackup([base])).toThrow(BackupError);
    expect(() => parseBackup(null)).toThrow(BackupError);
  });

  test('rejects backups from a newer format version', () => {
    expect(() => parseBackup({ format: 'call-search-backup', version: 2, records: [] })).toThrow('새 버전');
  });

  test('skips invalid records, fills defaults and normalizes text', () => {
    const parsed = parseBackup({
      format: 'call-search-backup',
      version: 1,
      records: [
        { id: 'ok', text: '홍길동'.normalize('NFD') + '  ', date: 5, dateSource: 'bogus', segments: [{ start: 1 }, { start: 0, end: 1, text: '네' }] },
        { id: '', text: 'x', date: 1 },
        { id: 'no-date', text: 'x' },
        'garbage',
      ],
    });
    expect(parsed.rejected).toBe(3);
    expect(parsed.records).toEqual([
      { id: 'ok', source: 'text', contact: '', number: '', date: 5, dateSource: 'manual', text: '홍길동', createdAt: 5, updatedAt: 5, segments: [{ start: 0, end: 1, text: '네' }] },
    ]);
  });
});

describe('planMerge', () => {
  test('adds new records, keeps newer local edits, takes newer incoming edits', () => {
    const local = [base, { ...base, id: 'r2', updatedAt: 100 }];
    const incoming = [
      { ...base, text: 'older copy', updatedAt: base.updatedAt - 1 },
      { ...base, id: 'r2', text: 'newer', updatedAt: 200 },
      { ...base, id: 'r3' },
      { ...base, id: 'r3', text: 'duplicate in file' },
    ];
    const plan = planMerge(local, incoming);
    expect(plan.added).toBe(1);
    expect(plan.updated).toBe(1);
    expect(plan.unchanged).toBe(1);
    expect(plan.toPut.map((r) => [r.id, r.text])).toEqual([
      ['r2', 'newer'],
      ['r3', base.text],
    ]);
  });
});
