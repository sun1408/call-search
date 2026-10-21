import { describe, expect, test } from 'bun:test';
import { SYSTEM_PROMPT, buildMessages, buildSources, chatgptShareText, citedSources, retrievalQuery, stripThinking, type ChatMessage } from '../src/core/prompt';
import type { Scored } from '../src/core/retrieval';
import type { CallRecord, Chunk } from '../src/core/types';

function scored(recordId: string, contact: string, index: number, text: string): Scored {
  const record: CallRecord = { id: recordId, source: 'audio', contact, number: '', date: 0, dateSource: 'filename', text: `${text} (전체 통화의 나머지 내용)`, createdAt: 0, updatedAt: 0 };
  const chunk: Chunk = { id: `${recordId}:${index}`, recordId, index, start: 0, end: text.length, text, model: 'fake', vector: new Float32Array(1) };
  return { record, chunk, score: 1, semantic: 1, keyword: 0 };
}

const hits = [scored('a', '김과장', 3, '계약서는 금요일까지 보내 주세요.'), scored('b', '이대리', 0, '회의는 화상으로 해요.'), scored('a', '김과장', 1, '단가는 그대로 갑니다.')];
const sources = buildSources(hits, (s) => s.record.contact, () => '10월 14일 (화) 오후 2:03');

describe('buildSources', () => {
  test('one numbered source per call with excerpts in transcript order', () => {
    expect(sources).toEqual([
      { n: 1, recordId: 'a', who: '김과장', when: '10월 14일 (화) 오후 2:03', excerpts: ['단가는 그대로 갑니다.', '계약서는 금요일까지 보내 주세요.'] },
      { n: 2, recordId: 'b', who: '이대리', when: '10월 14일 (화) 오후 2:03', excerpts: ['회의는 화상으로 해요.'] },
    ]);
  });
});

describe('buildMessages', () => {
  test('system rules, trimmed history, then numbered excerpts and the question', () => {
    const history: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` }));
    const messages = buildMessages('  김과장이 뭐라 했지?  ', sources, history, { maxHistoryMessages: 4 });
    expect(messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(messages.slice(1, 5).map((m) => m.content)).toEqual(['turn 6', 'turn 7', 'turn 8', 'turn 9']);
    const last = messages[messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content).toBe('[통화 발췌]\n[1] 김과장 · 10월 14일 (화) 오후 2:03\n단가는 그대로 갑니다.\n...\n계약서는 금요일까지 보내 주세요.\n\n[2] 이대리 · 10월 14일 (화) 오후 2:03\n회의는 화상으로 해요.\n\n질문: 김과장이 뭐라 했지?');
  });

  test('says so when nothing was found and clips long history', () => {
    const messages = buildMessages('질문', [], [{ role: 'assistant', content: '가'.repeat(50) }], { maxHistoryChars: 10 });
    expect(messages[1]!.content).toBe('가'.repeat(10) + '…');
    expect(messages[2]!.content).toContain('(관련 통화를 찾지 못했어요)');
  });
});

describe('citedSources', () => {
  test('reads [n], [n, m] and [n][m] in first-cited order and ignores unknown numbers', () => {
    expect(citedSources('금요일까지 보내 달래요 [2][1]. 단가는 같아요 [1, 7].', sources).map((s) => s.n)).toEqual([2, 1]);
    expect(citedSources('근거 없음', sources)).toEqual([]);
  });
});

describe('retrievalQuery', () => {
  const history: ChatMessage[] = [{ role: 'user', content: '김과장이 계약서 얘기 뭐라 했지?' }, { role: 'assistant', content: '금요일까지 보내 달래요 [1].' }];
  test('short or referring follow-ups carry the previous question', () => {
    expect(retrievalQuery('언제였어?', history)).toBe('김과장이 계약서 얘기 뭐라 했지? 언제였어?');
    expect(retrievalQuery('그때 단가 얘기도 했어?', history)).toBe('김과장이 계약서 얘기 뭐라 했지? 그때 단가 얘기도 했어?');
  });
  test('a new standalone question stands alone', () => {
    expect(retrievalQuery('이대리랑 회의 장소 정한 통화 찾아줘', history)).toBe('이대리랑 회의 장소 정한 통화 찾아줘');
    expect(retrievalQuery('언제였어?', [])).toBe('언제였어?');
  });
});

describe('chatgptShareText', () => {
  test('carries the question and the retrieved excerpts only, never the full transcripts', () => {
    const text = chatgptShareText('김과장이 뭐라 했지?', sources);
    expect(text).toContain('질문: 김과장이 뭐라 했지?');
    expect(text).toContain('[1] 김과장');
    expect(text).toContain('계약서는 금요일까지 보내 주세요.');
    expect(text).not.toContain('전체 통화의 나머지 내용');
  });
});

describe('stripThinking', () => {
  test('removes closed and unclosed think blocks', () => {
    expect(stripThinking('<think>고민 중</think>\n답이에요 [1]')).toBe('답이에요 [1]');
    expect(stripThinking('<think>아직 생각 중')).toBe('');
  });
});
