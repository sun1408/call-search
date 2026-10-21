export interface TextChunk {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface ChunkOptions {
  target?: number;
  max?: number;
  overlap?: number;
}

interface Unit {
  start: number;
  end: number;
}

// Sentence units end at a line break or after ., ?, !, … (and their full-width forms) followed by whitespace.
function sentenceUnits(text: string): Unit[] {
  const units: Unit[] = [];
  const boundary = /[.?!。？！…]+(?=\s)|\n+/g;
  let from = 0;
  for (const m of text.matchAll(boundary)) {
    const end = m.index! + (m[0].startsWith('\n') ? 0 : m[0].length);
    pushTrimmed(text, from, end, units);
    from = m.index! + m[0].length;
  }
  pushTrimmed(text, from, text.length, units);
  return units;
}

function pushTrimmed(text: string, start: number, end: number, out: Unit[]): void {
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  if (end > start) out.push({ start, end });
}

function splitLong(text: string, unit: Unit, max: number): Unit[] {
  const pieces: Unit[] = [];
  let start = unit.start;
  while (unit.end - start > max) {
    let cut = text.lastIndexOf(' ', start + max);
    if (cut <= start) cut = start + max;
    pieces.push({ start, end: cut });
    start = cut;
    while (start < unit.end && /\s/.test(text[start]!)) start++;
  }
  if (unit.end > start) pieces.push({ start, end: unit.end });
  return pieces;
}

/** Packs sentences into chunks of about `target` characters (never over `max`), repeating a short last sentence of one chunk at the start of the next. */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const { target = 300, max = 600, overlap = 80 } = options;
  const units = sentenceUnits(text).flatMap((u) => (u.end - u.start > max ? splitLong(text, u, max) : [u]));
  const chunks: TextChunk[] = [];
  let current: Unit[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const start = current[0]!.start;
    const end = current[current.length - 1]!.end;
    chunks.push({ index: chunks.length, start, end, text: text.slice(start, end) });
    const last = current[current.length - 1]!;
    current = current.length > 1 && last.end - last.start <= overlap ? [last] : [];
  };
  for (const unit of units) {
    const start = current[0]?.start ?? unit.start;
    if (current.length > 0 && unit.end - start > target) {
      flush();
      if (current.length > 0 && unit.end - current[0]!.start > max) current = [];
    }
    current.push(unit);
  }
  if (current.length > 0 && !(chunks.length > 0 && current.length === 1 && current[0]!.end <= chunks[chunks.length - 1]!.end)) flush();
  return chunks;
}
