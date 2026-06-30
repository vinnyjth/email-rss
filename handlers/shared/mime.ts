import { simpleParser } from "mailparser";
import { convert } from "html-to-text";

/**
 * Cap synthesized content. The body is chunked and each chunk is sent to Boson
 * separately (see tts.ts), but Boson's free-preview endpoint is slow (~35s per
 * ~450 chars) with a 60s gateway timeout, so synthesizing an entire long
 * newsletter would take many minutes and routinely fail. We therefore cap to
 * the subject + opening (~3 small chunks), which reliably produces audio.
 * TODO: when on a faster/paid TTS tier, raise this and lift the per-request cap.
 */
const MAX_TTS_CHARS = 1350;

export interface ParsedEmail {
  subject: string;
  from: string;
  /** Cleaned, readable plain text suitable for TTS (truncated to MAX_TTS_CHARS). */
  body: string;
}

/**
 * Prepare a forwarded email's body for TTS. This is a *forwarding* service, so
 * the original message usually arrives quoted with ">" prefixes — that quoted
 * content is exactly what we want read aloud, so we DE-QUOTE it rather than drop
 * it. We only strip the thin forwarding wrapper (marker lines + the quoted
 * From/To/Date/Subject header block) and a trailing signature.
 */
function cleanForwardedBody(text: string): string {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    // Remove any depth of leading quote markers: "> > foo" -> "foo".
    const line = rawLine.replace(/^(\s*>\s?)+/, "");
    const t = line.trim();

    // Signature delimiter ends the meaningful content.
    if (t === "--") break;
    // Forwarding wrapper marker lines.
    if (/^(begin forwarded message:|-+\s*(original|forwarded) message\s*-+)$/i.test(t)) {
      continue;
    }
    // Quoted email header block (From:/To:/Date:/Subject:/etc.).
    if (/^(from|to|cc|bcc|date|sent|subject|reply-to):\s/i.test(t)) continue;
    out.push(line);
  }
  return out.join("\n");
}

/** Collapse excess whitespace so the TTS engine reads naturally. */
function tidy(text: string): string {
  return text
    .replace(/ /g, " ")
    .replace(/<https?:\/\/[^>]+>/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[<(]\s*[>)]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parseEmail(raw: Buffer): Promise<ParsedEmail> {
  const mail = await simpleParser(raw);

  const subject = (mail.subject || "Untitled email").trim();
  const from = mail.from?.text || "unknown sender";

  let body: string;
  if (mail.text && mail.text.trim()) {
    body = mail.text;
  } else if (mail.html) {
    body = convert(mail.html, {
      wordwrap: false,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
      ],
    });
  } else {
    body = "";
  }

  body = tidy(cleanForwardedBody(body));
  if (body.length > MAX_TTS_CHARS) {
    body = body.slice(0, MAX_TTS_CHARS) + "\n\n[Message truncated.]";
  }

  return { subject, from, body };
}
