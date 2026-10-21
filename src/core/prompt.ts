import type { Scored } from './retrieval';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Source {
  n: number;
  recordId: string;
  who: string;
  when: string;
  excerpts: string[];
}

export const SYSTEM_PROMPT = [
  '너는 사용자의 휴대폰에 저장된 통화 기록으로 질문에 답하는 비서야.',
  '아래 [통화 발췌]에 적힌 내용만 근거로 한국어로 짧게 답해.',
  '발췌에 없는 내용은 지어내지 말고 "통화 기록에서 찾지 못했어요."라고 답해.',
  '답에 쓴 통화는 문장 끝에 [1]처럼 번호로 표시해.',
].join(' ');

/** One numbered source per call, its excerpts in transcript order. */
export function buildSources(scored: Scored[], who: (s: Scored) => string, when: (s: Scored) => string): Source[] {
  const byRecord = new Map<string, { source: Source; parts: Array<{ index: number; text: string }> }>();
  for (const s of scored) {
    let entry = byRecord.get(s.record.id);
    if (!entry) {
      entry = { source: { n: byRecord.size + 1, recordId: s.record.id, who: who(s), when: when(s), excerpts: [] }, parts: [] };
      byRecord.set(s.record.id, entry);
    }
    entry.parts.push({ index: s.chunk.index, text: s.chunk.text });
  }
  return [...byRecord.values()].map(({ source, parts }) => ({ ...source, excerpts: parts.sort((a, b) => a.index - b.index).map((p) => p.text) }));
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function formatSources(sources: Source[], maxExcerptChars = 400): string {
  return sources.map((s) => `[${s.n}] ${s.who} · ${s.when}\n${s.excerpts.map((e) => clip(e, maxExcerptChars)).join('\n...\n')}`).join('\n\n');
}

export interface PromptOptions {
  maxHistoryMessages?: number;
  maxHistoryChars?: number;
}

/** System rules, the recent conversation (without old excerpts), then this turn's excerpts and question. */
export function buildMessages(question: string, sources: Source[], history: ChatMessage[], options: PromptOptions = {}): ChatMessage[] {
  const { maxHistoryMessages = 6, maxHistoryChars = 600 } = options;
  const recent = history
    .filter((m) => m.role !== 'system')
    .slice(-maxHistoryMessages)
    .map((m) => ({ role: m.role, content: clip(m.content, maxHistoryChars) }));
  const context = sources.length > 0 ? formatSources(sources) : '(관련 통화를 찾지 못했어요)';
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...recent, { role: 'user', content: `[통화 발췌]\n${context}\n\n질문: ${question.trim()}` }];
}

/** Sources cited as [n], [n, m] or [n][m] in an answer, in first-cited order; numbers without a source are ignored. */
export function citedSources(answer: string, sources: Source[]): Source[] {
  const cited: Source[] = [];
  for (const group of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const n of group[1]!.split(',').map((x) => Number(x.trim()))) {
      const source = sources.find((s) => s.n === n);
      if (source && !cited.includes(source)) cited.push(source);
    }
  }
  return cited;
}

export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
}

const REFERRING = /그거|그것|그때|그 사람|그분|거기|그 통화|그건|그럼|왜|언제였|누구였|더 자세히|자세히/;

/** A follow-up that leans on the previous question ("그때 뭐라고 했어?") is searched together with it. */
export function retrievalQuery(question: string, history: ChatMessage[]): string {
  const previous = [...history].reverse().find((m) => m.role === 'user');
  if (!previous) return question;
  const short = question.replace(/\s+/g, '').length < 10;
  return short || REFERRING.test(question) ? `${previous.content} ${question}` : question;
}

export function chatgptShareText(question: string, sources: Source[]): string {
  const intro = '아래는 내 통화 기록에서 찾은 발췌야. 이 발췌만 보고 질문에 답해 줘. 답에 쓴 발췌는 [번호]로 알려 줘.';
  return `${intro}\n\n질문: ${question.trim()}\n\n${formatSources(sources)}`;
}
