import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});

let cachedKey: string | undefined;

/** Read + cache the Boson API key from SSM Parameter Store (SecureString). */
async function bosonApiKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const name = process.env.BOSON_API_KEY_PARAM;
  if (!name) throw new Error("BOSON_API_KEY_PARAM env var not set");
  const res = await ssm.send(
    new GetParameterCommand({ Name: name, WithDecryption: true })
  );
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter ${name} is empty`);
  cachedKey = value;
  return value;
}

const BOSON_ENDPOINT = "https://api.boson.ai/v1/audio/speech";

export interface SpeechResult {
  audio: Buffer;
  contentType: string;
}

// Boson's free-preview endpoint has a ~60s gateway timeout and is slow
// (~35s for 500 chars); inputs much larger than this reliably time out. Keep
// chunks small so each request finishes well under the gateway limit.
const MAX_CHARS_PER_REQUEST = 450;
const MAX_RETRIES = 2;

/**
 * Synthesize `text` to MP3 via Boson AI's Higgs Audio v3 TTS (OpenAI-compatible).
 * Long text is split into sub-5000-char chunks (on paragraph/sentence
 * boundaries), each synthesized separately, and the resulting MP3s concatenated.
 */
export async function synthesize(text: string): Promise<SpeechResult> {
  const chunks = chunkText(text, MAX_CHARS_PER_REQUEST);
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    buffers.push(await synthesizeOne(chunk));
  }
  return { audio: Buffer.concat(buffers), contentType: "audio/mpeg" };
}

async function synthesizeOne(text: string): Promise<Buffer> {
  const key = await bosonApiKey();
  const voice = process.env.TTS_VOICE || "jake";

  let lastErr = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(BOSON_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "higgs-tts-3",
        input: text,
        voice,
        response_format: "mp3",
      }),
    });

    if (res.ok) return Buffer.from(await res.arrayBuffer());

    const detail = await res.text().catch(() => "");
    lastErr = `${res.status} ${res.statusText} ${detail}`;
    // 5xx (incl. 504 gateway timeout) on the free preview is often transient.
    if (res.status < 500 || attempt === MAX_RETRIES) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`Boson TTS failed: ${lastErr}`);
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
