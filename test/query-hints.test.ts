import { describe, expect, test } from 'bun:test';
import { parseQueryHints } from '../src/core/query-hints';

const NOW = new Date(2026, 9, 21, 15, 30);
const PEOPLE = ['김과장', '이대리', '010-1234-5678'];
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
const end = (y: number, m: number, d: number) => new Date(y, m - 1, d, 23, 59, 59, 999).getTime();

describe('parseQueryHints', () => {
  test('the brief example: a contact and last week', () => {
    const hints = parseQueryHints('김과장이 지난주에 뭐라 했지?', PEOPLE, NOW);
    expect(hints.people).toEqual(['김과장']);
    expect(hints.from).toBe(day(2026, 10, 12));
    expect(hints.to).toBe(end(2026, 10, 18));
    expect(hints.matched).toEqual(['김과장', '지난주']);
  });

  test('names match across spacing and numbers across dashes', () => {
    expect(parseQueryHints('김 과장님 전화', PEOPLE, NOW).people).toEqual(['김과장']);
    expect(parseQueryHints('01012345678 이 사람 누구야', PEOPLE, NOW).people).toEqual(['010-1234-5678']);
  });

  test('relative days', () => {
    expect(parseQueryHints('오늘 통화', [], NOW)).toMatchObject({ from: day(2026, 10, 21), to: end(2026, 10, 21) });
    expect(parseQueryHints('어제 뭐라고 했어', [], NOW)).toMatchObject({ from: day(2026, 10, 20), to: end(2026, 10, 20) });
    expect(parseQueryHints('그저께', [], NOW)).toMatchObject({ from: day(2026, 10, 19) });
    expect(parseQueryHints('3일 전에', [], NOW)).toMatchObject({ from: day(2026, 10, 18), to: end(2026, 10, 18) });
    expect(parseQueryHints('최근 7일 동안', [], NOW)).toMatchObject({ from: day(2026, 10, 14), to: end(2026, 10, 21) });
  });

  test('weeks start on Monday', () => {
    expect(parseQueryHints('이번 주에', [], NOW)).toMatchObject({ from: day(2026, 10, 19), to: end(2026, 10, 21) });
  });

  test('months and explicit dates', () => {
    expect(parseQueryHints('지난달 통화', [], NOW)).toMatchObject({ from: day(2026, 9, 1), to: end(2026, 9, 30) });
    expect(parseQueryHints('이번달', [], NOW)).toMatchObject({ from: day(2026, 10, 1), to: end(2026, 10, 21) });
    expect(parseQueryHints('10월 14일에 무슨 얘기', [], NOW)).toMatchObject({ from: day(2026, 10, 14), to: end(2026, 10, 14) });
    expect(parseQueryHints('12월 3일', [], NOW)).toMatchObject({ from: day(2025, 12, 3) });
    expect(parseQueryHints('8월에', [], NOW)).toMatchObject({ from: day(2026, 8, 1), to: end(2026, 8, 31) });
  });

  test('no hints when nothing matches', () => {
    expect(parseQueryHints('계약서 이야기', PEOPLE, NOW)).toEqual({ people: [], matched: [] });
  });
});
