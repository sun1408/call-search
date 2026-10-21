import type { QueryHints } from './query-hints';
import { normalizeForSearch, personKey } from './search';
import type { CallRecord, Chunk } from './types';

export interface RetrievalOptions {
  topK?: number;
  perRecord?: number;
  keywordWeight?: number;
}

export interface Scored {
  chunk: Chunk;
  record: CallRecord;
  score: number;
  semantic: number;
  keyword: number;
}

const STOPWORDS = new Set([
  '뭐라', '뭐라고', '뭐라고했지', '했지', '했어', '했나', '했었지', '언제', '어디', '무슨', '어떤', '누가', '그때', '거기', '그거',
  '얘기', '이야기', '통화', '전화', '대해', '관해', '알려줘', '말해줘', '뭐였지', '뭐야', '있었지', '있어', '찾아줘',
  '오늘', '어제', '그저께', '지난주', '저번주', '이번주', '지난달', '저번달', '이번달', '최근', '작년', '올해',
]);

// Trailing particles and honorifics; stripped (at most twice) only when two or more characters remain, so 회의 and 필요 stay whole.
const PARTICLE = /(이랑|에서|에게|한테|까지|부터|으로|은|는|이|가|을|를|에|의|와|과|도|로|랑|님|씨)$/u;

function stem(word: string): string {
  let w = word;
  for (let pass = 0; pass < 2; pass++) {
    const m = w.match(PARTICLE);
    if (!m || w.length - m[0].length < 2) break;
    w = w.slice(0, -m[0].length);
  }
  return w;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** Content words of a question: particles stripped, filler and date words dropped (dates are handled as hints), two characters or longer. */
export function keywords(question: string): string[] {
  const words = question
    .split(/[\s,.?!]+/)
    .map((w) => stem(normalizeForSearch(w).norm))
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

function keywordScore(chunkText: string, who: string, words: string[]): number {
  if (words.length === 0) return 0;
  const body = normalizeForSearch(`${chunkText} ${who}`).norm;
  return words.filter((w) => body.includes(w)).length / words.length;
}

/**
 * Ranks chunks by embedding similarity (vectors are L2-normalized, so the dot product is the cosine)
 * plus a keyword bonus. People and dates named in the question narrow the candidates when any call matches them.
 * Without a query vector the ranking is keyword-only, newest first on ties.
 */
export function retrieve(
  queryVector: Float32Array | null,
  question: string,
  chunks: Chunk[],
  records: Map<string, CallRecord>,
  hints: QueryHints,
  options: RetrievalOptions = {},
): Scored[] {
  const { topK = 6, perRecord = 2, keywordWeight = 0.15 } = options;
  let candidates = chunks.filter((c) => records.has(c.recordId));
  if (hints.people.length > 0) {
    const narrowed = candidates.filter((c) => hints.people.includes(personKey(records.get(c.recordId)!)));
    if (narrowed.length > 0) candidates = narrowed;
  }
  if (hints.from !== undefined && hints.to !== undefined) {
    const narrowed = candidates.filter((c) => {
      const date = records.get(c.recordId)!.date;
      return date >= hints.from! && date <= hints.to!;
    });
    if (narrowed.length > 0) candidates = narrowed;
  }
  const words = keywords(question);
  const scored = candidates.map((chunk) => {
    const record = records.get(chunk.recordId)!;
    const semantic = queryVector ? dot(queryVector, chunk.vector) : 0;
    const keyword = keywordScore(chunk.text, personKey(record), words);
    return { chunk, record, semantic, keyword, score: semantic + keywordWeight * keyword };
  });
  if (!queryVector) {
    const anyKeyword = scored.some((s) => s.keyword > 0);
    if (anyKeyword) scored.splice(0, scored.length, ...scored.filter((s) => s.keyword > 0));
  }
  scored.sort((a, b) => b.score - a.score || b.record.date - a.record.date || a.chunk.index - b.chunk.index);
  const perCall = new Map<string, number>();
  const picked: Scored[] = [];
  for (const s of scored) {
    const used = perCall.get(s.record.id) ?? 0;
    if (used >= perRecord) continue;
    perCall.set(s.record.id, used + 1);
    picked.push(s);
    if (picked.length >= topK) break;
  }
  return picked;
}
