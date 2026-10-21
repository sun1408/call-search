import { describe, expect, test } from 'bun:test';
import { cleanText, embeddingText } from '../src/core/text';

describe('embeddingText', () => {
  test('re-attaches particles SenseVoice split off', () => {
    expect(embeddingText('조 금만 생각 을 하 면서 살 면 훨씬 편할 거야.')).toBe('조 금만 생각을 하 면서 살 면 훨씬 편할 거야.');
    expect(embeddingText('계약서 를 사무실 에서 김과장 에게, 서울 까지')).toBe('계약서를 사무실에서 김과장에게, 서울까지');
  });

  test('leaves normally typed text and particle-like word starts alone', () => {
    expect(embeddingText('회의 일정을 금요일 오전으로 바꾸죠. 장소는 본사 3층 회의실입니다.')).toBe('회의 일정을 금요일 오전으로 바꾸죠. 장소는 본사 3층 회의실입니다.');
    expect(embeddingText('오늘 은행 에 갔다')).toBe('오늘 은행 에 갔다');
  });

  test('normalizes NFD and collapses whitespace', () => {
    expect(embeddingText('  홍길동\n\n 전화 '.normalize('NFD'))).toBe('홍길동 전화');
  });
});

describe('cleanText', () => {
  test('keeps transcript spacing as recognized', () => {
    expect(cleanText('조 금만 생각 을\r\n하 면서  ')).toBe('조 금만 생각 을\n하 면서');
  });
});
