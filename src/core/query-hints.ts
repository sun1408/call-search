import { normalizeForSearch } from './search';

export interface QueryHints {
  people: string[];
  from?: number;
  to?: number;
  matched: string[];
}

const DAY = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

function monday(d: Date): Date {
  const day = (d.getDay() + 6) % 7;
  return addDays(startOfDay(d), -day);
}

type Range = { from: number; to: number; label: string };

function dateRange(question: string, now: Date): Range | null {
  const q = question.replace(/\s+/g, ' ');
  const today = startOfDay(now);
  const day = (d: Date, label: string): Range => ({ from: d.getTime(), to: endOfDay(d), label });
  let m: RegExpMatchArray | null;
  if (/그저께|그제/.test(q)) return day(addDays(today, -2), '그저께');
  if (/어제/.test(q)) return day(addDays(today, -1), '어제');
  if (/오늘/.test(q)) return day(today, '오늘');
  if (/지난\s?주|저번\s?주/.test(q)) {
    const start = addDays(monday(now), -7);
    return { from: start.getTime(), to: endOfDay(addDays(start, 6)), label: '지난주' };
  }
  if (/이번\s?주/.test(q)) return { from: monday(now).getTime(), to: endOfDay(now), label: '이번 주' };
  if (/지난\s?달|저번\s?달/.test(q)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { from: start.getTime(), to: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)), label: '지난달' };
  }
  if (/이번\s?달/.test(q)) return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to: endOfDay(now), label: '이번 달' };
  if ((m = q.match(/최근\s?(\d{1,3})\s?일/))) {
    const n = Number(m[1]);
    return { from: addDays(today, -n).getTime(), to: endOfDay(now), label: `최근 ${n}일` };
  }
  if ((m = q.match(/(\d{1,3})\s?일\s?전/))) return day(addDays(today, -Number(m[1])), `${m[1]}일 전`);
  if ((m = q.match(/(\d{1,2})\s?월\s?(\d{1,2})\s?일/))) {
    const month = Number(m[1]) - 1;
    const date = Number(m[2]);
    let d = new Date(now.getFullYear(), month, date);
    if (d.getTime() > now.getTime()) d = new Date(now.getFullYear() - 1, month, date);
    if (d.getMonth() === month) return day(d, `${month + 1}월 ${date}일`);
  }
  if ((m = q.match(/(\d{1,2})\s?월/))) {
    const month = Number(m[1]) - 1;
    if (month >= 0 && month < 12) {
      const year = month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
      return { from: new Date(year, month, 1).getTime(), to: endOfDay(new Date(year, month + 1, 0)), label: `${month + 1}월` };
    }
  }
  if (/작년/.test(q)) return { from: new Date(now.getFullYear() - 1, 0, 1).getTime(), to: endOfDay(new Date(now.getFullYear() - 1, 11, 31)), label: '작년' };
  if (/올해/.test(q)) return { from: new Date(now.getFullYear(), 0, 1).getTime(), to: endOfDay(now), label: '올해' };
  return null;
}

/** Finds people (by contact name or number, ignoring spaces) and a relative or absolute date range mentioned in a question. */
export function parseQueryHints(question: string, people: string[], now: Date): QueryHints {
  const normalized = normalizeForSearch(question).norm;
  const matchedPeople = people.filter((person) => {
    const key = normalizeForSearch(person).norm;
    return key.length >= 2 && normalized.includes(key);
  });
  const range = dateRange(question, now);
  const hints: QueryHints = { people: matchedPeople, matched: [...matchedPeople] };
  if (range) {
    hints.from = range.from;
    hints.to = range.to;
    hints.matched.push(range.label);
  }
  return hints;
}

export const DAY_MS = DAY;
