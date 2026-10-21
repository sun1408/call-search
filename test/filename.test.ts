import { describe, expect, test } from 'bun:test';
import { parseRecordingName, resolveCallTime, type DateParts } from '../src/core/filename';

const kst = (p: DateParts) => Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - 9 * 3600_000;
const NOW = Date.UTC(2026, 9, 21, 0, 0, 0);

describe('parseRecordingName', () => {
  test('A./T전화 number with a UTC stamp', () => {
    const p = parseRecordingName('01025777190_20260327202518.m4a');
    expect(p).toEqual({ contact: '', number: '01025777190', parts: { y: 2026, mo: 3, d: 27, h: 20, mi: 25, s: 18 }, basis: 'utc', format: 'tphone' });
  });

  test('A./T전화 duplicate suffix and folder path', () => {
    const p = parseRecordingName('Recordings/TPhoneCallRecords/01025777190_20260327202518-1.m4a');
    expect(p.format).toBe('tphone');
    expect(p.number).toBe('01025777190');
    expect(p.parts).toEqual({ y: 2026, mo: 3, d: 27, h: 20, mi: 25, s: 18 });
  });

  test('A./T전화 number with the 82 country code', () => {
    expect(parseRecordingName('821025777190_20251215083000.m4a').number).toBe('01025777190');
  });

  test('A./T전화 contact name, number and stamp', () => {
    const p = parseRecordingName('시댁_01077249063_20261003165911.m4a');
    expect(p.contact).toBe('시댁');
    expect(p.number).toBe('01077249063');
    expect(p.parts).toEqual({ y: 2026, mo: 10, d: 3, h: 16, mi: 59, s: 11 });
  });

  test('contact name with a space and no number', () => {
    const p = parseRecordingName('김 과장_20260115093000.m4a');
    expect(p.contact).toBe('김 과장');
    expect(p.number).toBe('');
    expect(p.format).toBe('tphone');
  });

  test('Samsung Phone recording with a name, local time', () => {
    const p = parseRecordingName('통화 녹음 홍길동_240115_093012.m4a');
    expect(p).toEqual({ contact: '홍길동', number: '', parts: { y: 2024, mo: 1, d: 15, h: 9, mi: 30, s: 12 }, basis: 'local', format: 'samsung-call' });
  });

  test('Samsung Phone recording with a number', () => {
    const p = parseRecordingName('통화 녹음 010-1234-5678_240115_093012.m4a');
    expect(p.number).toBe('01012345678');
    expect(p.contact).toBe('');
  });

  test('label with yyMMdd_HHmmss', () => {
    const p = parseRecordingName('메디웨일_260120_120138.m4a');
    expect(p.contact).toBe('메디웨일');
    expect(p.format).toBe('label-date');
    expect(p.parts).toEqual({ y: 2026, mo: 1, d: 20, h: 12, mi: 1, s: 38 });
  });

  test('generic dashed stamp', () => {
    const p = parseRecordingName('Call recording 홍길동 2025-01-02 13-04-05.m4a');
    expect(p.format).toBe('generic');
    expect(p.contact).toBe('홍길동');
    expect(p.parts).toEqual({ y: 2025, mo: 1, d: 2, h: 13, mi: 4, s: 5 });
  });

  test('decomposed (NFD) Hangul is normalized', () => {
    const p = parseRecordingName('통화 녹음 홍길동_240115_093012.m4a'.normalize('NFD'));
    expect(p.contact).toBe('홍길동');
  });

  test('impossible date gives no stamp but keeps the number', () => {
    const p = parseRecordingName('01012345678_20261340990000.m4a');
    expect(p.parts).toBeNull();
    expect(p.format).toBe('none');
    expect(p.number).toBe('01012345678');
  });

  test('no recognizable parts', () => {
    expect(parseRecordingName('voice_memo.m4a')).toEqual({ contact: '', number: '', parts: null, basis: null, format: 'none' });
  });
});

describe('resolveCallTime', () => {
  test('UTC stamp is read as UTC', () => {
    const p = parseRecordingName('01025777190_20260826054434.m4a');
    expect(resolveCallTime(p, undefined, NOW, kst)).toEqual({ date: Date.UTC(2026, 7, 26, 5, 44, 34), source: 'filename' });
  });

  test('UTC stamp consistent with the file time stays UTC', () => {
    const p = parseRecordingName('01025777190_20260826054434.m4a');
    const mtime = Date.UTC(2026, 7, 26, 5, 50, 0);
    expect(resolveCallTime(p, mtime, NOW, kst).date).toBe(Date.UTC(2026, 7, 26, 5, 44, 34));
  });

  test('a UTC reading after the file was written falls back to local time', () => {
    // File written 05:50 UTC (14:50 KST); digits 14:44:34 read as UTC would be after that.
    const p = parseRecordingName('01025777190_20260826144434.m4a');
    const mtime = Date.UTC(2026, 7, 26, 5, 50, 0);
    expect(resolveCallTime(p, mtime, NOW, kst)).toEqual({ date: Date.UTC(2026, 7, 26, 5, 44, 34), source: 'filename' });
  });

  test('local stamp uses the local converter', () => {
    const p = parseRecordingName('통화 녹음 홍길동_240115_093012.m4a');
    expect(resolveCallTime(p, undefined, NOW, kst).date).toBe(Date.UTC(2024, 0, 15, 0, 30, 12));
  });

  test('a stamp in the future is ignored in favour of the file time', () => {
    const p = parseRecordingName('01025777190_20271231235959.m4a');
    expect(resolveCallTime(p, 1_700_000_000_000, NOW, kst)).toEqual({ date: 1_700_000_000_000, source: 'file' });
  });

  test('no stamp uses the file time, then now', () => {
    const p = parseRecordingName('voice_memo.m4a');
    expect(resolveCallTime(p, 1_700_000_000_000, NOW, kst)).toEqual({ date: 1_700_000_000_000, source: 'file' });
    expect(resolveCallTime(p, undefined, NOW, kst)).toEqual({ date: NOW, source: 'now' });
    expect(resolveCallTime(p, 0, NOW, kst)).toEqual({ date: NOW, source: 'now' });
  });
});
