export const SAMPLE_RATE = 16_000;

export interface DecodedAudio {
  samples: Float32Array;
  duration: number;
}

export async function decodeToMono16k(blob: Blob): Promise<DecodedAudio> {
  const data = await blob.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  let audio: AudioBuffer;
  try {
    audio = await context.decodeAudioData(data);
  } catch {
    throw new Error('이 파일의 소리를 읽지 못했어요. m4a, mp3, wav 같은 녹음 파일인지 확인해 주세요.');
  }
  const samples = new Float32Array(audio.length);
  if (audio.numberOfChannels === 1) {
    audio.copyFromChannel(samples, 0);
  } else {
    const scratch = new Float32Array(audio.length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      audio.copyFromChannel(scratch, c);
      for (let i = 0; i < scratch.length; i++) samples[i]! += scratch[i]! / audio.numberOfChannels;
    }
  }
  return { samples, duration: audio.duration };
}
