import { formatNumber } from './phone';
import type { CallRecord } from './types';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function clock(d: Date): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatWhen(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const yesterday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  if (sameDay(d, n)) return `오늘 ${clock(d)}`;
  if (sameDay(d, yesterday)) return `어제 ${clock(d)}`;
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

export function formatFull(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]}) ${clock(d)}`;
}

export function formatShortDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  if (m > 0) return sec > 0 ? `${m}분 ${sec}초` : `${m}분`;
  return `${sec}초`;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

export function displayName(record: Pick<CallRecord, 'contact' | 'number'>): string {
  return record.contact || formatNumber(record.number) || '알 수 없는 상대';
}

export function recordShareText(record: CallRecord): string {
  const who = record.contact && record.number ? `${record.contact} (${formatNumber(record.number)})` : displayName(record);
  const lines = ['[통화 기록]', `상대: ${who}`, `일시: ${formatFull(record.date)}`];
  if (record.durationSec) lines.push(`길이: ${formatDuration(record.durationSec)}`);
  return `${lines.join('\n')}\n\n${record.text}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): number {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return Number.NaN;
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!).getTime();
}

export function dayStart(value: string): number {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getTime();
}

export function dayEnd(value: string): number {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 23, 59, 59, 999).getTime();
}
