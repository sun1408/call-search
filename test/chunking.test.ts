import { describe, expect, test } from 'bun:test';
import { chunkText } from '../src/core/chunking';

const sentence = (i: number) => `${i}번째 문장에서는 다음 주 일정과 계약 조건을 다시 확인했습니다.`;

describe('chunkText', () => {
  test('empty and blank text give no chunks', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('  \n  ')).toEqual([]);
  });

  test('short text is one chunk with exact offsets', () => {
    const text = '  안녕하세요. 내일 봬요.  ';
    expect(chunkText(text)).toEqual([{ index: 0, start: 2, end: 15, text: '안녕하세요. 내일 봬요.' }]);
  });

  test('long text splits into ordered chunks within the size limit whose offsets slice back to their text', () => {
    const text = Array.from({ length: 30 }, (_, i) => sentence(i + 1)).join(' ');
    const chunks = chunkText(text, { target: 120, max: 200, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) {
      expect(text.slice(c.start, c.end)).toBe(c.text);
      expect(c.text.length).toBeLessThanOrEqual(200);
    }
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    expect(chunks[0]!.start).toBe(0);
    expect(chunks[chunks.length - 1]!.end).toBe(text.length);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.start).toBeGreaterThanOrEqual(chunks[i - 1]!.end);
  });

  test('a short closing sentence is repeated at the start of the next chunk', () => {
    const text = ['가'.repeat(90) + '.', '짧은 문장.', '나'.repeat(90) + '.'].join(' ');
    const chunks = chunkText(text, { target: 110, max: 200, overlap: 20 });
    expect(chunks.map((c) => c.text)).toEqual(['가'.repeat(90) + '. 짧은 문장.', '짧은 문장. ' + '나'.repeat(90) + '.']);
  });

  test('line breaks end sentences, as in VAD segments', () => {
    const chunks = chunkText('첫 구간\n둘째 구간\n셋째 구간', { target: 8, max: 20, overlap: 0 });
    expect(chunks.map((c) => c.text)).toEqual(['첫 구간', '둘째 구간', '셋째 구간']);
  });

  test('one very long sentence is cut at spaces under the limit', () => {
    const text = Array.from({ length: 80 }, () => '단어').join(' ');
    const chunks = chunkText(text, { target: 50, max: 60, overlap: 0 });
    expect(chunks.every((c) => c.text.length <= 60 && !c.text.startsWith(' ') && !c.text.endsWith(' '))).toBe(true);
    expect(chunks.map((c) => c.text).join(' ')).toBe(text);
  });
});
