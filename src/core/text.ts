export function cleanText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// Particles that never start a Korean word. SenseVoice often puts a space before them ("생각 을"); joining them back
// brings transcripts closer to normally spaced text before embedding. Removing every space instead made e5 rank worse.
const DETACHED_PARTICLE = /([\uac00-\ud7a3]) (을|를|은|는|의|에서|에게|으로|까지|부터)(?=[\s.,?!]|$)/g;

export function embeddingText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().replace(DETACHED_PARTICLE, '$1$2');
}
