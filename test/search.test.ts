import { describe, expect, test } from 'bun:test';
import { listPeople, makeDoc, makeSnippets, normalizeForSearch, search, type SnippetPart } from '../src/core/search';
import type { CallRecord } from '../src/core/types';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);

function rec(id: string, text: string, date: number, contact = '', number = ''): CallRecord {
  return { id, source: 'text', contact, number, date, dateSource: 'manual', text, createdAt: date, updatedAt: date };
}

const marks = (parts: SnippetPart[][]) => parts.flat().filter((p) => p.mark).map((p) => p.text);

const records = [
  rec('a', '내일 오후 세 시에 계약서 들고 사무실로 오세요.', T0, '김과장', '01011112222'),
  rec('b', '계약 서류는 다음 주에 보내 드릴게요. Zoom 링크는 문자로 드릴게요.', T0 + DAY, '이대리', '01033334444'),
  rec('c', '회의 일정을 금요일로 바꾸죠. 제 번호는 010-1234-5678 입니다.', T0 + 2 * DAY, '김과장', '01011112222'),
  rec('d', '택배가 문 앞에 있습니다.', T0 + 3 * DAY, '', '15881234'),
];
const docs = records.map(makeDoc);
const ids = (q: string, f = {}) => search(docs, q, f).map((h) => h.record.id);

describe('normalizeForSearch', () => {
  test('drops spaces and punctuation, lowercases, and maps back to the original', () => {
    const n = normalizeForSearch('A 계약 서.');
    expect(n.norm).toBe('a계약서');
    expect(n.starts).toEqual([0, 2, 3, 5]);
    expect(n.ends).toEqual([1, 3, 4, 6]);
  });
});

describe('search', () => {
  test('matches regardless of spacing and marks the original text', () => {
    const hits = search(docs, '계약서');
    expect(hits.map((h) => h.record.id)).toEqual(['b', 'a']);
    expect(marks(hits[0]!.snippets)).toEqual(['계약 서']);
    expect(marks(hits[1]!.snippets)).toEqual(['계약서']);
  });

  test('SenseVoice transcripts with spaces inside words still match the normally spaced word', () => {
    const asr = [makeDoc(rec('asr', '조 금만 생각 을 하 면서 살 면 훨씬 편할 거야.', T0))];
    expect(marks(search(asr, '조금만')[0]!.snippets)).toEqual(['조 금만']);
    expect(marks(search(asr, '하면서')[0]!.snippets)).toEqual(['하 면서']);
    expect(marks(search(asr, '생각을 하면서')[0]!.snippets)).toEqual(['생각 을', '하 면서']);
    expect(search(asr, '조금만')[0]!.record.text).toBe('조 금만 생각 을 하 면서 살 면 훨씬 편할 거야.');
  });

  test('space-separated terms must all match', () => {
    expect(ids('계약 내일')).toEqual(['a']);
    expect(ids('계약 금요일')).toEqual([]);
  });

  test('is case-insensitive for Latin text', () => {
    expect(ids('zoom')).toEqual(['b']);
  });

  test('phone numbers match with or without dashes', () => {
    const hits = search(docs, '01012345678');
    expect(hits.map((h) => h.record.id)).toEqual(['c']);
    expect(marks(hits[0]!.snippets)).toEqual(['010-1234-5678']);
  });

  test('contact names and numbers match even when absent from the text', () => {
    expect(ids('김과장')).toEqual(['c', 'a']);
    expect(ids('1588-1234')).toEqual(['d']);
  });

  test('an empty query lists everything newest first', () => {
    expect(ids('')).toEqual(['d', 'c', 'b', 'a']);
    expect(search(docs, '   ')[0]!.snippets[0]![0]!.mark).toBe(false);
  });

  test('filters by person and inclusive date range', () => {
    expect(ids('', { person: '김과장' })).toEqual(['c', 'a']);
    expect(ids('', { person: '1588-1234' })).toEqual(['d']);
    expect(ids('', { from: T0 + DAY, to: T0 + 2 * DAY })).toEqual(['c', 'b']);
    expect(ids('계약', { person: '김과장' })).toEqual(['a']);
  });

  test('overlapping terms merge into one mark', () => {
    const hits = search(docs, '계약 계약서');
    expect(marks(hits.find((h) => h.record.id === 'a')!.snippets)).toEqual(['계약서']);
  });
});

describe('makeSnippets', () => {
  const long = '가'.repeat(100) + '계약' + '나'.repeat(200) + '계약' + '다'.repeat(100);
  const ranges: [number, number][] = [[100, 102], [302, 304]];

  test('two distant hits give two windows with ellipses', () => {
    const snippets = makeSnippets(long, ranges, { before: 5, after: 5 });
    expect(snippets).toHaveLength(2);
    expect(snippets[0]).toEqual([
      { text: '…', mark: false },
      { text: '가'.repeat(5), mark: false },
      { text: '계약', mark: true },
      { text: '나'.repeat(5), mark: false },
      { text: '…', mark: false },
    ]);
  });

  test('max limits the number of windows', () => {
    expect(makeSnippets(long, ranges, { max: 1 })).toHaveLength(1);
  });

  test('no hits gives the head of the text', () => {
    expect(makeSnippets('짧은\n글', [])).toEqual([[{ text: '짧은 글', mark: false }]]);
    expect(makeSnippets('가'.repeat(10), [], { plain: 4 })).toEqual([[{ text: '가가가가…', mark: false }]]);
  });
});

describe('listPeople', () => {
  test('one entry per contact or number, most recent call first', () => {
    expect(listPeople(records)).toEqual([
      { key: '1588-1234', count: 1, last: T0 + 3 * DAY },
      { key: '김과장', count: 2, last: T0 + 2 * DAY },
      { key: '이대리', count: 1, last: T0 + DAY },
    ]);
  });
});
