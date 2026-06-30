import { Episode } from "./dynamo";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hms(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export interface FeedMeta {
  feedId: string;
  ownerEmail: string;
  cdnDomain: string; // e.g. d111.cloudfront.net
}

/**
 * Build a podcast-compatible RSS 2.0 feed (with iTunes tags) for a user's
 * episodes. `episodes` should already be newest-first.
 */
export function buildRss(meta: FeedMeta, episodes: Episode[]): string {
  const base = `https://${meta.cdnDomain}`;
  const feedUrl = `${base}/feeds/${meta.feedId}.xml`;
  const title = "Forwarded Emails";
  const desc = `Emails forwarded by ${meta.ownerEmail}, read aloud.`;
  const lastBuild = episodes[0]?.pubDate ?? new Date(0).toUTCString();

  const items = episodes
    .map((ep) => {
      const url = `${base}/${ep.audioKey}`;
      return `    <item>
      <title>${esc(ep.title)}</title>
      <description>${esc(ep.summary)}</description>
      <pubDate>${esc(ep.pubDate)}</pubDate>
      <guid isPermaLink="false">${esc(ep.guid)}</guid>
      <enclosure url="${esc(url)}" length="${ep.bytes}" type="audio/mpeg" />
      <itunes:duration>${hms(ep.durationSec)}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(title)}</title>
    <link>${esc(base)}</link>
    <atom:link href="${esc(feedUrl)}" rel="self" type="application/rss+xml" />
    <description>${esc(desc)}</description>
    <language>en-us</language>
    <lastBuildDate>${esc(lastBuild)}</lastBuildDate>
    <itunes:author>${esc(meta.ownerEmail)}</itunes:author>
    <itunes:summary>${esc(desc)}</itunes:summary>
    <itunes:explicit>false</itunes:explicit>
    <itunes:category text="Technology" />
${items}
  </channel>
</rss>
`;
}
