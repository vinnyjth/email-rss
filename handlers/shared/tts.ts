import {
  PollyClient,
  SynthesizeSpeechCommand,
  Engine,
  VoiceId,
} from "@aws-sdk/client-polly";

const polly = new PollyClient({});

export interface SpeechResult {
  audio: Buffer;
  contentType: string;
}

// Amazon Polly's SynthesizeSpeech accepts up to 3000 billed characters per
// request; chunk a bit under that and concatenate the resulting MP3s.
const MAX_CHARS_PER_REQUEST = 2900;
const DEFAULT_VOICE = "Matthew";
const DEFAULT_ENGINE = "neural";

/**
 * Synthesize `text` to MP3 via Amazon Polly. Long text is split into
 * <=3000-char chunks (on paragraph/sentence boundaries) and the resulting MP3s
 * are concatenated. Polly is fast and reliable, so chunks run sequentially.
 */
export async function synthesize(text: string): Promise<SpeechResult> {
  const voice = (process.env.TTS_VOICE || DEFAULT_VOICE) as VoiceId;
  const engine = (process.env.TTS_ENGINE || DEFAULT_ENGINE) as Engine;

  const chunks = chunkText(text, MAX_CHARS_PER_REQUEST);
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    const res = await polly.send(
      new SynthesizeSpeechCommand({
        Text: chunk,
        OutputFormat: "mp3",
        VoiceId: voice,
        Engine: engine,
      })
    );
    if (!res.AudioStream) throw new Error("Polly returned no audio stream");
    buffers.push(Buffer.from(await res.AudioStream.transformToByteArray()));
  }

  if (!buffers.length) throw new Error("TTS produced no audio (empty input)");
  return { audio: Buffer.concat(buffers), contentType: "audio/mpeg" };
}

/** Split text into <= max-char chunks, preferring paragraph then sentence breaks. */
export function chunkText(text: string, max: number): string[] {
  const chunks: string[] = [];
  let buf = "";
  const push = () => {
    if (buf.trim()) chunks.push(buf.trim());
    buf = "";
  };
  const add = (piece: string, sep: string) => {
    if (!buf) buf = piece;
    else if ((buf + sep + piece).length <= max) buf += sep + piece;
    else {
      push();
      buf = piece;
    }
  };

  for (const para of text.split(/\n\n+/)) {
    if (para.length <= max) {
      add(para, "\n\n");
      continue;
    }
    // Paragraph too long: break into sentences.
    for (const sent of para.split(/(?<=[.!?])\s+/)) {
      if (sent.length <= max) {
        add(sent, " ");
        continue;
      }
      // Sentence too long: hard-split.
      push();
      for (let i = 0; i < sent.length; i += max) chunks.push(sent.slice(i, i + max));
    }
  }
  push();
  return chunks.length ? chunks : [];
}
