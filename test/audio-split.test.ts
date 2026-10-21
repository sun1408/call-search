import { describe, expect, test } from 'bun:test';
import { splitAtSilence } from '../src/core/audio-split';

const RATE = 100;

function tone(seconds: number, quiet: Array<[number, number]> = []): Float32Array {
  const samples = new Float32Array(seconds * RATE);
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    samples[i] = quiet.some(([a, b]) => t >= a && t < b) ? 0 : i % 2 === 0 ? 0.5 : -0.5;
  }
  return samples;
}

describe('splitAtSilence', () => {
  test('short audio stays one piece', () => {
    expect(splitAtSilence(tone(20), RATE)).toEqual([{ start: 0, end: 2000, silent: false }]);
  });

  test('cuts land in the quiet gaps and pieces cover the audio without gaps', () => {
    const pieces = splitAtSilence(tone(70, [[24, 25], [49, 50]]), RATE);
    expect(pieces).toHaveLength(3);
    expect(pieces[0]!.end).toBeGreaterThanOrEqual(24 * RATE);
    expect(pieces[0]!.end).toBeLessThan(25 * RATE);
    expect(pieces[1]!.end).toBeGreaterThanOrEqual(49 * RATE);
    expect(pieces[1]!.end).toBeLessThan(50 * RATE);
    expect(pieces.map((p) => p.start)).toEqual([0, pieces[0]!.end, pieces[1]!.end]);
    expect(pieces[2]!.end).toBe(70 * RATE);
    expect(pieces.every((p) => p.end - p.start <= 28 * RATE)).toBe(true);
  });

  test('without any quiet frame the cut falls inside the allowed window', () => {
    const pieces = splitAtSilence(tone(60), RATE);
    expect(pieces.length).toBe(3);
    expect(pieces[0]!.end).toBeGreaterThanOrEqual(10 * RATE);
    expect(pieces[0]!.end).toBeLessThanOrEqual(28 * RATE);
    expect(pieces[pieces.length - 1]!.end).toBe(60 * RATE);
  });

  test('silent pieces are marked so they can be skipped', () => {
    const pieces = splitAtSilence(tone(40, [[0, 40]]), RATE);
    expect(pieces.every((p) => p.silent)).toBe(true);
  });
});
