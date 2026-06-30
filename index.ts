import * as fs from "fs";
import * as path from "path";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

import { createTables } from "./infra/database";
import { createBuckets } from "./infra/storage";
import { createCdn } from "./infra/cdn";
import { createApi } from "./infra/api";
import { createEmail } from "./infra/email";
import { createDns } from "./infra/dns";

const cfg = new pulumi.Config();
const domain = cfg.require("domain");
const inboxSubdomain = cfg.get("inboxSubdomain") ?? "inbox";
const inboxDomain = `${inboxSubdomain}.${domain}`;
const route53ZoneId = cfg.get("route53ZoneId") ?? "";
const appHost = cfg.get("appHost") ?? "";
const acmCertArn = cfg.get("acmCertArn") ?? "";
const ttsVoice = cfg.get("ttsVoice") ?? "jake";
const bosonApiKey = cfg.requireSecret("bosonApiKey");

const region = aws.config.requireRegion();

// Data + storage.
const { users, episodes } = createTables();
const { web, media, incoming, incomingSesPolicy } = createBuckets();

// CDN in front of web + media.
const { cdnDomain } = createCdn({
  web,
  media,
  appHost: appHost || undefined,
  acmCertArn: acmCertArn || undefined,
});

// Registration API.
const { apiUrl } = createApi({ usersTable: users, inboxDomain, cdnDomain });

// Inbound email -> TTS -> RSS.
const { identity, dkim } = createEmail({
  inboxDomain,
  incoming,
  incomingSesPolicy,
  media,
  usersTable: users,
  episodesTable: episodes,
  cdnDomain,
  bosonApiKey,
  ttsVoice,
});

// DNS (Route53 if a zone is configured; otherwise values are exported below).
const dns = createDns({
  zoneId: route53ZoneId,
  region,
  inboxDomain,
  identity,
  dkim,
});

// Publish the registration page with the API URL injected.
const template = fs.readFileSync(path.join(__dirname, "web", "index.html"), "utf8");
new aws.s3.BucketObject("web-index", {
  bucket: web.id,
  key: "index.html",
  content: apiUrl.apply((url) => template.replace("__API_URL__", url)),
  contentType: "text/html; charset=utf-8",
  cacheControl: "public, max-age=300",
});

// Outputs.
export const appUrl = pulumi.interpolate`https://${cdnDomain}`;
export const registerApiUrl = apiUrl;
export const forwardDomain = inboxDomain;
export const dnsManaged = dns.managed;
// If dnsManaged is false, add these records to your DNS provider manually:
export const dnsRecordsToAdd = dns.managed ? undefined : dns.manual;
