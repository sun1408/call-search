/**
 * Reads contact, number and call time out of call-recording file names.
 *
 * Known shapes:
 * - A.(에이닷)/T전화, folder Recordings/TPhoneCallRecords:
 *   `<number>_<yyyyMMddHHmmss>[-N].m4a` and `<name>_<number>_<yyyyMMddHHmmss>[-N].m4a`.
 *   The stamp is in UTC (a call at 14:44 KST is stored as ..._20260826054434.m4a).
 * - Samsung Phone: `통화 녹음 <name or number>_<yyMMdd>_<HHmmss>.m4a`, local time.
 * - Voice-recorder style: `<label>_<yyMMdd>_<HHmmss>.<ext>`, local time.
 * - Anything else with a `yyyy-MM-dd HH-mm[-ss]` stamp, local time.
 */
import { looksLikePhoneNumber, normalizeNumber } from './phone';

export interface DateParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

export type TimeBasis = 'utc' | 'local';
export type NameFormat = 'tphone' | 'samsung-call' | 'label-date' | 'generic' | 'none';

export interface ParsedRecordingName {
  contact: string;
  number: string;
  parts: DateParts | null;
  basis: TimeBasis | null;
  format: NameFormat;
}

const PREFIXES = [/^\[?\s*t\s*전화\s*통화\s*녹음\s*\]?/i, /^통화\s*녹음/, /^call\s*recording/i, /^recording/i, /^녹음/];

function baseName(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? fileName;
  return last.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();
}

function valid(p: DateParts): DateParts | null {
  if (p.y < 2000 || p.y > 2099 || p.mo < 1 || p.mo > 12 || p.d < 1 || p.d > 31) return null;
  if (p.h > 23 || p.mi > 59 || p.s > 59) return null;
  const day = new Date(Date.UTC(p.y, p.mo - 1, p.d));
  return day.getUTCMonth() === p.mo - 1 && day.getUTCDate() === p.d ? p : null;
}

function num(s: string | undefined): number {
  return s === undefined ? 0 : Number.parseInt(s, 10);
}

function parts14(stamp: string): DateParts | null {
  const m = stamp.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  return valid({ y: num(m[1]), mo: num(m[2]), d: num(m[3]), h: num(m[4]), mi: num(m[5]), s: num(m[6]) });
}

function partsShort(date6: string, time6: string): DateParts | null {
  const d = date6.match(/^(\d{2})(\d{2})(\d{2})$/);
  const t = time6.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!d || !t) return null;
  return valid({ y: 2000 + num(d[1]), mo: num(d[2]), d: num(d[3]), h: num(t[1]), mi: num(t[2]), s: num(t[3]) });
}

function cleanLabel(label: string): string {
  let s = label.trim();
  for (const re of PREFIXES) s = s.replace(re, '');
  return s
    .replace(/_+/g, ' ')
    .replace(/^[\s\-.,[\]()]+|[\s\-.,[\]()]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitWho(label: string): { contact: string; number: string } {
  let number = '';
  const rest: string[] = [];
  for (const token of label.split(/\s+/).filter(Boolean)) {
    if (!number && looksLikePhoneNumber(token) && token.replace(/\D/g, '').length >= 7) number = normalizeNumber(token);
    else rest.push(token);
  }
  return { contact: rest.join(' '), number };
}

export function parseRecordingName(fileName: string): ParsedRecordingName {
  const base = baseName(fileName.normalize('NFC'));

  // A./T전화: [<name>_][<number>_]<yyyyMMddHHmmss>[-N]
  let m = base.match(/^(?:(.*)_)?(\d{14})(?:-\d+)?$/);
  if (m) {
    const parts = parts14(m[2]!);
    if (parts) return { ...splitWho(cleanLabel(m[1] ?? '')), parts, basis: 'utc', format: 'tphone' };
  }

  // Samsung Phone: 통화 녹음 <who>_<yyMMdd>_<HHmmss>
  m = base.match(/^통화\s*녹음\s*(.*?)_(\d{6})_(\d{6})(?:\s*\(\d+\))?$/);
  if (m) {
    const parts = partsShort(m[2]!, m[3]!);
    if (parts) return { ...splitWho(cleanLabel(m[1]!)), parts, basis: 'local', format: 'samsung-call' };
  }

  // <label>_<yyMMdd>_<HHmmss>
  m = base.match(/^(.*?)_(\d{6})_(\d{6})(?:\s*\(\d+\))?$/);
  if (m) {
    const parts = partsShort(m[2]!, m[3]!);
    if (parts) return { ...splitWho(cleanLabel(m[1]!)), parts, basis: 'local', format: 'label-date' };
  }

  // Any yyyy-MM-dd HH-mm[-ss] stamp.
  m = base.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[\s_T-]?(\d{2})[-_.:h시]?(\d{2})(?:[-_.:m분]?(\d{2}))?/);
  if (m) {
    const parts = valid({ y: num(m[1]), mo: num(m[2]), d: num(m[3]), h: num(m[4]), mi: num(m[5]), s: num(m[6]) });
    if (parts) return { ...splitWho(cleanLabel(base.replace(m[0], ' '))), parts, basis: 'local', format: 'generic' };
  }

  return { contact: '', number: splitWho(cleanLabel(base)).number, parts: null, basis: null, format: 'none' };
}

export interface ResolvedTime {
  date: number;
  source: 'filename' | 'file' | 'now';
}

export function localTime(p: DateParts): number {
  return new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s).getTime();
}

const SLACK_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Picks the call time: the file-name stamp when there is one, else the file's modification time, else now.
 * A UTC stamp that would put the call after the file was written is read as local time instead.
 */
export function resolveCallTime(
  parsed: ParsedRecordingName,
  fileLastModified: number | undefined,
  now: number,
  toLocal: (p: DateParts) => number = localTime,
): ResolvedTime {
  const mtime = fileLastModified !== undefined && Number.isFinite(fileLastModified) && fileLastModified > 0 ? fileLastModified : undefined;
  if (parsed.parts) {
    const p = parsed.parts;
    const local = toLocal(p);
    let date = parsed.basis === 'utc' ? Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) : local;
    if (parsed.basis === 'utc' && mtime !== undefined && date > mtime + SLACK_MS && local <= mtime + SLACK_MS) date = local;
    if (date <= now + DAY_MS) return { date, source: 'filename' };
  }
  if (mtime !== undefined) return { date: mtime, source: 'file' };
  return { date: now, source: 'now' };
}
