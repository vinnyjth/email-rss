/**
 * Estimate the duration (seconds) of a CBR MP3 by scanning frame headers.
 * Good enough for an <itunes:duration> hint without pulling in a heavy decoder.
 * Falls back to a bitrate guess if no frames parse.
 */
const BITRATES_V1_L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
];
const SAMPLE_RATES_V1 = [44100, 48000, 32000, 0];
const SAMPLE_RATES_V2 = [22050, 24000, 16000, 0];

export function estimateMp3DurationSec(buf: Buffer): number {
  let i = 0;
  let totalSamples = 0;
  let sampleRate = 0;

  while (i + 4 <= buf.length) {
    // Frame sync: 11 set bits.
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const versionBits = (buf[i + 1] >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2
    const layerBits = (buf[i + 1] >> 1) & 0x03; // 1 = Layer III
    if (layerBits !== 0x01) {
      i++;
      continue;
    }
    const bitrateIdx = (buf[i + 2] >> 4) & 0x0f;
    const sampleRateIdx = (buf[i + 2] >> 2) & 0x03;
    const padding = (buf[i + 2] >> 1) & 0x01;

    const bitrate = BITRATES_V1_L3[bitrateIdx] * 1000;
    const isV1 = versionBits === 0x03;
    sampleRate = (isV1 ? SAMPLE_RATES_V1 : SAMPLE_RATES_V2)[sampleRateIdx];
    if (!bitrate || !sampleRate) {
      i++;
      continue;
    }

    const samplesPerFrame = isV1 ? 1152 : 576;
    const frameLen = Math.floor(
      (samplesPerFrame / 8 * bitrate) / sampleRate + padding
    );
    if (frameLen <= 0) {
      i++;
      continue;
    }
    totalSamples += samplesPerFrame;
    i += frameLen;
  }

  if (totalSamples && sampleRate) return totalSamples / sampleRate;
  // Fallback: assume 128 kbps CBR.
  return (buf.length * 8) / 128000;
}
