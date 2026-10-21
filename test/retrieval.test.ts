import { describe, expect, test } from 'bun:test';
import type { QueryHints } from '../src/core/query-hints';
import { keywords, retrieve } from '../src/core/retrieval';
import type { CallRecord, Chunk } from '../src/core/types';

const DAY = 86_400_000;
const T = Date.UTC(2026, 9, 10);
const none: QueryHints = { people: [], matched: [] };

function record(id: string, contact: string, date: number): CallRecord {
  return { id, source: 'audio', contact, number: '', date, dateSource: 'filename', text: '', createdAt: date, updatedAt: date };
}

function unit(v: number[]): Float32Array {
  const n = Math.hypot(...v);
  return new Float32Array(v.map((x) => x / n));
}

function chunk(recordId: string, index: number, text: string, v: number[]): Chunk {
  return { id: `${recordId}:${index}`, recordId, index, start: 0, end: text.length, text, model: 'fake', vector: unit(v) };
}

const records = new Map([
  ['a', record('a', '김과장', T)],
  ['b', record('b', '이대리', T + DAY)],
  ['c', record('c', '김과장', T + 8 * DAY)],
]);

const chunks = [
  chunk('a', 0, '계약서는 다음 주에 보내 드릴게요.', [1, 0, 0]),
  chunk('a', 1, '주차는 지하 2층입니다.', [0, 1, 0]),
  chunk('a', 2, '계약 조건은 그대로 갑니다.', [0.9, 0.1, 0]),
  chunk('b', 0, '회의 장소를 바꿨어요.', [0, 0, 1]),
  chunk('c', 0, '견적서를 다시 보내 주세요.', [0.95, 0, 0.05]),
];

describe('keywords', () => {
  test('drops particles, fillers and date words', () => {
    expect(keywords('김과장이 지난주에 계약서 얘기를 뭐라고 했지?')).toEqual(['김과장', '계약서']);
  });

  test('keeps short nouns whole and strips honorifics', () => {
    expect(keywords('회의 필요 김과장님이 사무실로')).toEqual(['회의', '필요', '김과장', '사무실']);
  });
});

describe('retrieve', () => {
  test('ranks by embedding similarity and keeps at most two chunks per call', () => {
    const hits = retrieve(unit([1, 0, 0]), '서류 언제 보내?', chunks, records, none, { topK: 4 });
    expect(hits.map((h) => h.chunk.id)).toEqual(['a:0', 'c:0', 'a:2', 'b:0']);
  });

  test('a keyword match lifts a chunk over a slightly closer vector', () => {
    const hits = retrieve(unit([0.97, 0, 0.03]), '견적서', chunks, records, none, { topK: 2, perRecord: 1 });
    expect(hits[0]!.chunk.id).toBe('c:0');
    expect(hits[0]!.keyword).toBe(1);
  });

  test('a named person narrows the candidates', () => {
    const hits = retrieve(unit([0, 0, 1]), '김과장이 뭐라 했지', chunks, records, { people: ['김과장'], matched: ['김과장'] });
    expect(new Set(hits.map((h) => h.record.id))).toEqual(new Set(['a', 'c']));
  });

  test('a date range narrows the candidates, but is ignored when no call falls in it', () => {
    const lastWeek: QueryHints = { people: [], from: T - DAY, to: T + 2 * DAY, matched: ['지난주'] };
    expect(new Set(retrieve(unit([1, 0, 0]), 'x', chunks, records, lastWeek).map((h) => h.record.id))).toEqual(new Set(['a', 'b']));
    const empty: QueryHints = { people: [], from: T + 100 * DAY, to: T + 101 * DAY, matched: ['12월'] };
    expect(retrieve(unit([1, 0, 0]), 'x', chunks, records, empty).length).toBeGreaterThan(0);
  });

  test('the keyword part ignores spaces SenseVoice puts inside Korean words', () => {
    const asrRecords = new Map([['x', record('x', '김과장', T)]]);
    const asrChunks = [chunk('x', 0, '조 금만 생각 을 하 면서 살 면', [1, 0, 0])];
    expect(retrieve(null, '조금만 생각을 하면서', asrChunks, asrRecords, none)[0]!.keyword).toBe(1);
  });

  test('without a query vector it falls back to keywords, newest first', () => {
    const hits = retrieve(null, '계약서 보내', chunks, records, none);
    expect(hits.map((h) => h.chunk.id)).toEqual(['a:0', 'c:0']);
    expect(retrieve(null, '없는말', chunks, records, none, { topK: 2 }).map((h) => h.record.id)).toEqual(['c', 'b']);
  });
});
