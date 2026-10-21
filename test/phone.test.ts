import { describe, expect, test } from 'bun:test';
import { formatNumber, looksLikePhoneNumber, normalizeNumber } from '../src/core/phone';

describe('normalizeNumber', () => {
  test('keeps digits only', () => expect(normalizeNumber(' 010-1234-5678 ')).toBe('01012345678'));
  test('+82 becomes 0', () => expect(normalizeNumber('+82 10-1234-5678')).toBe('01012345678'));
  test('+82 with a redundant 0', () => expect(normalizeNumber('+82 010 1234 5678')).toBe('01012345678'));
  test('bare 82 in front of a mobile number', () => expect(normalizeNumber('821025777190')).toBe('01025777190'));
  test('a number that only starts with 82 is left alone', () => expect(normalizeNumber('8212')).toBe('8212'));
});

describe('formatNumber', () => {
  test.each([
    ['01012345678', '010-1234-5678'],
    ['0111234567', '011-123-4567'],
    ['021234567', '02-123-4567'],
    ['0212345678', '02-1234-5678'],
    ['0311234567', '031-123-4567'],
    ['07012345678', '070-1234-5678'],
    ['050512345678', '0505-1234-5678'],
    ['15881234', '1588-1234'],
    ['114', '114'],
    ['', ''],
  ])('%s -> %s', (raw, want) => expect(formatNumber(raw)).toBe(want));
});

describe('looksLikePhoneNumber', () => {
  test('numbers', () => {
    expect(looksLikePhoneNumber('010-1234-5678')).toBe(true);
    expect(looksLikePhoneNumber('+82 10 1234 5678')).toBe(true);
    expect(looksLikePhoneNumber('114')).toBe(true);
  });
  test('not numbers', () => {
    expect(looksLikePhoneNumber('홍길동')).toBe(false);
    expect(looksLikePhoneNumber('12')).toBe(false);
    expect(looksLikePhoneNumber('a1234567')).toBe(false);
  });
});
