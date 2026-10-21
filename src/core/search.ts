import { formatNumber } from './phone';
import type { CallRecord } from './types';

// Ignored while matching, so "계약 서" finds "계약서" and "01012345678" finds "010-1234-5678".
const IGNORED = /[\s.,!?·…~"'“”‘’()[\]{}<>:;\-_/\\|*#@^`=+]/;

export type Range = [number, number];

/** Text with ignored characters removed and lowercased; starts/ends map each kept unit back to the original string. */
export interface NormalizedText {
  norm: string;
  starts: number[];
  ends: number[];
}

export function normalizeForSearch(text: string): NormalizedText {
  const units: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of text) {
    if (!IGNORED.test(ch)) {
      const lower = ch.toLowerCase();
      for (let k = 0; k < lower.length; k++) {
        units.push(lower[k]!);
        starts.push(i);
        ends.push(i + ch.length);
      }
    }
    i += ch.length;
  }
  return { norm: units.join(''), starts, ends };
}

export interface SearchDoc {
  record: CallRecord;
  body: NormalizedText;
  meta: string;
}

export function personKey(record: Pick<CallRecord, 'contact' | 'number'>): string {
  return record.contact.trim() || formatNumber(record.number);
}

export function makeDoc(record: CallRecord): SearchDoc {
  const meta = `${record.contact} ${record.number} ${record.fileName ?? ''}`;
  return { record, body: normalizeForSearch(record.text), meta: normalizeForSearch(meta).norm };
}

export function queryTerms(query: string): string[] {
  return query
    .normalize('NFC')
    .split(/\s+/)
    .map((term) => normalizeForSearch(term).norm)
    .filter((term) => term.length > 0);
}

export function findRanges(body: NormalizedText, term: string, limit = 500): Range[] {
  const ranges: Range[] = [];
  let from = 0;
  while (ranges.length < limit) {
    const at = body.norm.indexOf(term, from);
    if (at < 0) break;
    ranges.push([body.starts[at]!, body.ends[at + term.length - 1]!]);
    from = at + term.length;
  }
  return ranges;
}

export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Range[] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export interface SnippetPart {
  text: string;
  mark: boolean;
}

export function highlight(text: string, ranges: Range[], from = 0, to = text.length): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let pos = from;
  for (const [start, end] of ranges) {
    if (end <= from || start >= to) continue;
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    if (a > pos) parts.push({ text: text.slice(pos, a), mark: false });
    parts.push({ text: text.slice(a, b), mark: true });
    pos = b;
  }
  if (pos < to) parts.push({ text: text.slice(pos, to), mark: false });
  return parts;
}

export interface SnippetOptions {
  max?: number;
  before?: number;
  after?: number;
  plain?: number;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ');

export function makeSnippets(text: string, ranges: Range[], options: SnippetOptions = {}): SnippetPart[][] {
  const { max = 2, before = 24, after = 48, plain = 90 } = options;
  if (ranges.length === 0) {
    return [[{ text: oneLine(text.slice(0, plain)) + (text.length > plain ? '…' : ''), mark: false }]];
  }
  const windows: Range[] = [];
  for (const [start, end] of ranges) {
    if (windows.length >= max) break;
    const last = windows[windows.length - 1];
    if (last && start < last[1]) continue;
    windows.push([Math.max(0, start - before), Math.min(text.length, end + after)]);
  }
  return mergeRanges(windows).map(([a, b]) => {
    const parts = highlight(text, ranges, a, b).map((p) => ({ text: oneLine(p.text), mark: p.mark }));
    if (a > 0) parts.unshift({ text: '…', mark: false });
    if (b < text.length) parts.push({ text: '…', mark: false });
    return parts;
  });
}

export interface SearchFilters {
  person?: string;
  from?: number;
  to?: number;
}

export interface SearchHit {
  record: CallRecord;
  ranges: Range[];
  snippets: SnippetPart[][];
}

export function matchesFilters(record: CallRecord, filters: SearchFilters): boolean {
  if (filters.person && personKey(record) !== filters.person) return false;
  if (filters.from !== undefined && record.date < filters.from) return false;
  if (filters.to !== undefined && record.date > filters.to) return false;
  return true;
}

export function newestFirst(a: CallRecord, b: CallRecord): number {
  return b.date - a.date || b.createdAt - a.createdAt;
}

/** Every query term (split on spaces) must appear in the transcript or in the contact/number/file name. */
export function search(docs: SearchDoc[], query: string, filters: SearchFilters = {}, options: SnippetOptions = {}): SearchHit[] {
  const terms = queryTerms(query);
  const hits: SearchHit[] = [];
  for (const doc of docs) {
    if (!matchesFilters(doc.record, filters)) continue;
    const found: Range[] = [];
    let matched = true;
    for (const term of terms) {
      const ranges = findRanges(doc.body, term);
      if (ranges.length === 0 && !doc.meta.includes(term)) {
        matched = false;
        break;
      }
      found.push(...ranges);
    }
    if (!matched) continue;
    const ranges = mergeRanges(found);
    hits.push({ record: doc.record, ranges, snippets: makeSnippets(doc.record.text, ranges, options) });
  }
  return hits.sort((a, b) => newestFirst(a.record, b.record));
}

export interface Person {
  key: string;
  count: number;
  last: number;
}

export function listPeople(records: CallRecord[]): Person[] {
  const people = new Map<string, Person>();
  for (const record of records) {
    const key = personKey(record);
    if (!key) continue;
    const person = people.get(key);
    if (person) {
      person.count++;
      person.last = Math.max(person.last, record.date);
    } else {
      people.set(key, { key, count: 1, last: record.date });
    }
  }
  return [...people.values()].sort((a, b) => b.last - a.last);
}
