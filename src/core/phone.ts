const NUMBER_CHARS = /^\+?[\d\s().-]+$/;

export function looksLikePhoneNumber(token: string): boolean {
  const t = token.trim();
  if (!NUMBER_CHARS.test(t)) return false;
  const digits = t.replace(/\D/g, '');
  return digits.length >= 3 && digits.length <= 15;
}

/** Digits only; the Korean country code (+82, or a bare 82 in front of a Korean number) becomes a leading 0. */
export function normalizeNumber(raw: string): string {
  const t = raw.trim();
  let digits = t.replace(/\D/g, '');
  if (t.startsWith('+') && digits.startsWith('82')) {
    digits = '0' + digits.slice(2).replace(/^0/, '');
  } else if (/^82(1\d{8,9}|[2-6]\d{7,9})$/.test(digits)) {
    digits = '0' + digits.slice(2);
  }
  return digits;
}

/** Display form, e.g. 010-1234-5678, 02-123-4567, 1588-1234. Unknown shapes come back as digits. */
export function formatNumber(raw: string): string {
  const d = normalizeNumber(raw);
  if (!d) return '';
  const three = (a: number, b: number) => `${d.slice(0, a)}-${d.slice(a, b)}-${d.slice(b)}`;
  if (/^01[016789]\d{7,8}$/.test(d)) return d.length === 11 ? three(3, 7) : three(3, 6);
  if (/^02\d{7,8}$/.test(d)) return d.length === 10 ? three(2, 6) : three(2, 5);
  if (/^0[3-7]\d{8,9}$/.test(d)) return d.length === 11 ? three(3, 7) : three(3, 6);
  if (/^050\d{9}$/.test(d)) return three(4, 8);
  if (/^1[5-9]\d{6}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return d;
}
