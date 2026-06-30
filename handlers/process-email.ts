import type { SESEvent } from "aws-lambda";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { parseEmail } from "./shared/mime";
import { synthesize } from "./shared/tts";
import { estimateMp3DurationSec } from "./shared/mp3";
import {
  getUserByToken,
  putEpisode,
  listEpisodes,
  Episode,
} from "./shared/dynamo";
import { buildRss } from "./shared/rss";
import { guid as newGuid } from "./shared/ids";

const s3 = new S3Client({});

const INCOMING_BUCKET = () => required("INCOMING_BUCKET");
const INCOMING_PREFIX = () => process.env.INCOMING_PREFIX || "raw/";
const MEDIA_BUCKET = () => required("MEDIA_BUCKET");
const CDN_DOMAIN = () => required("CDN_DOMAIN");
const INBOX_DOMAIN = () => required("INBOX_DOMAIN");

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env var not set`);
  return v;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  // @ts-expect-error Node stream is async-iterable at runtime
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Extract the local-part token from the recipient matching our inbox domain. */
function tokenFromRecipients(recipients: string[]): string | undefined {
  const suffix = `@${INBOX_DOMAIN()}`.toLowerCase();
  for (const r of recipients) {
    const addr = r.toLowerCase();
    if (addr.endsWith(suffix)) return addr.slice(0, -suffix.length);
  }
  return undefined;
}

export const handler = async (event: SESEvent): Promise<void> => {
  for (const record of event.Records) {
    const { mail, receipt } = record.ses;
    const messageId = mail.messageId;

    const token = tokenFromRecipients(receipt.recipients);
    if (!token) {
      console.warn(`No recipient matched inbox domain for ${messageId}; skipping`);
      continue;
    }

    const user = await getUserByToken(token);
    if (!user) {
      console.warn(`Unknown forwarding token ${token} (msg ${messageId}); skipping`);
      continue;
    }

    // Raw MIME was written by the SES S3 action (ordered before this Lambda).
    const key = `${INCOMING_PREFIX()}${messageId}`;
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: INCOMING_BUCKET(), Key: key })
    );
    const raw = await streamToBuffer(obj.Body);

    const { subject, from, body } = await parseEmail(raw);
    if (!body.trim()) {
      console.warn(`Empty body for ${messageId}; skipping synthesis`);
      continue;
    }

    // Read the subject line first, then the body, so the audio is self-describing.
    const speechText = `${subject}.\n\n${body}`;
    const { audio } = await synthesize(speechText);

    const guid = newGuid();
    const audioKey = `audio/${user.feedId}/${guid}.mp3`;
    await s3.send(
      new PutObjectCommand({
        Bucket: MEDIA_BUCKET(),
        Key: audioKey,
        Body: audio,
        ContentType: "audio/mpeg",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );

    const episode: Episode = {
      feedId: user.feedId,
      sortKey: `${Date.now()}#${guid}`,
      guid,
      title: subject,
      summary: `Forwarded from ${from}`,
      audioKey,
      bytes: audio.length,
      durationSec: Math.round(estimateMp3DurationSec(audio)),
      pubDate: new Date().toUTCString(),
    };
    await putEpisode(episode);

    // Rebuild the whole feed from DynamoDB and publish it.
    const episodes = await listEpisodes(user.feedId);
    const xml = buildRss(
      { feedId: user.feedId, ownerEmail: user.email, cdnDomain: CDN_DOMAIN() },
      episodes
    );
    await s3.send(
      new PutObjectCommand({
        Bucket: MEDIA_BUCKET(),
        Key: `feeds/${user.feedId}.xml`,
        Body: xml,
        ContentType: "application/rss+xml",
        CacheControl: "public, max-age=60",
      })
    );

    console.log(
      `Published episode ${guid} for feed ${user.feedId} (${audio.length} bytes)`
    );
  }
};
