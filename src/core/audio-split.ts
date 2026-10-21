export interface AudioPiece {
  start: number;
  end: number;
  silent: boolean;
}

export interface SplitOptions {
  maxSeconds?: number;
  minSeconds?: number;
  frameMs?: number;
  silenceRms?: number;
}

function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
  return end > start ? Math.sqrt(sum / (end - start)) : 0;
}

/**
 * Cuts audio into pieces no longer than `maxSeconds` (Whisper's window is 30 s), choosing each cut at the
 * quietest frame between `minSeconds` and `maxSeconds` after the previous cut (the latest one on ties, so
 * pieces stay long), and marks pieces that are silence.
 */
export function splitAtSilence(samples: Float32Array, sampleRate: number, options: SplitOptions = {}): AudioPiece[] {
  const { maxSeconds = 28, minSeconds = 10, frameMs = 50, silenceRms = 0.003 } = options;
  const max = Math.floor(maxSeconds * sampleRate);
  const min = Math.floor(minSeconds * sampleRate);
  const frame = Math.max(1, Math.floor((frameMs / 1000) * sampleRate));
  const pieces: AudioPiece[] = [];
  let start = 0;
  while (start < samples.length) {
    let end = samples.length;
    if (samples.length - start > max) {
      let best = start + max;
      let bestEnergy = Number.POSITIVE_INFINITY;
      for (let at = start + min; at + frame <= start + max; at += frame) {
        const energy = rms(samples, at, at + frame);
        if (energy <= bestEnergy) {
          bestEnergy = energy;
          best = at + Math.floor(frame / 2);
        }
      }
      end = best;
    }
    pieces.push({ start, end, silent: rms(samples, start, end) < silenceRms });
    start = end;
  }
  return pieces;
}
