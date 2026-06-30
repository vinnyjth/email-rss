# email-rss — forward emails into a private podcast

Register with your email, get a unique forwarding address, and forward any email
to it. Each forwarded email is converted to speech (Boson AI **Higgs Audio v3**)
and published as an episode on a private podcast RSS feed only you have the link
to.

Static UI + audio + RSS live on **S3** (behind CloudFront); the dynamic pieces
run on **SES inbound + Lambda + DynamoDB**. All infrastructure is **Pulumi
(TypeScript)**.

## Architecture

```
Registration:  browser ──► CloudFront/S3 (form) ──► API Gateway ──► Lambda(register) ──► DynamoDB(Users)
                                                                       └─ returns {forwardAddress, rssUrl}

Forwarded mail: sender ──► MX inbox.<domain> ──► SES receipt rule
                  ├─ (1) S3 action      ──► S3(incoming): raw MIME
                  └─ (2) Lambda action  ──► Lambda(processEmail)
                            parse MIME → Boson Higgs TTS → MP3
                            → S3(media)/audio/<feedId>/<guid>.mp3
                            → DynamoDB(Episodes)
                            → rebuild RSS → S3(media)/feeds/<feedId>.xml

Podcast app:   CloudFront ──► S3(media): /feeds/*.xml, /audio/*.mp3
```

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/) and a state backend
  (`pulumi login`).
- AWS credentials for an account, region **us-east-1** (SES inbound is supported
  there).
- A domain you control. Inbound mail uses a subdomain (`inbox.<domain>`) so your
  root MX is never touched.
- A Boson AI API key — get one free at <https://boson.ai/workspace> (Higgs Audio
  v3 TTS is in free public preview).
- Node 18+ locally (handlers are bundled with esbuild at `pulumi up` time).

## Configure

```bash
npm install
pulumi stack init dev

pulumi config set aws:region us-east-1
pulumi config set email-rss:domain example.com           # your apex domain
pulumi config set email-rss:inboxSubdomain inbox          # optional (default: inbox)
pulumi config set email-rss:ttsVoice jake                 # optional Higgs voice
pulumi config set --secret email-rss:bosonApiKey <key>    # Boson API key -> SSM

# If your DNS is in Route53, set the zone id so MX/TXT/DKIM are created for you:
pulumi config set email-rss:route53ZoneId Z0123456789ABC  # optional

# Optional custom hostname for the app (ACM cert must be in us-east-1):
# pulumi config set email-rss:appHost app.example.com
# pulumi config set email-rss:acmCertArn arn:aws:acm:us-east-1:...:certificate/...
```

## Deploy

```bash
pulumi up
```

Useful outputs:

- `appUrl` — the registration site (CloudFront).
- `registerApiUrl` — the API base URL (also baked into the page).
- `forwardDomain` — `inbox.<domain>`.
- `dnsManaged` — `true` if Route53 records were created.
- `dnsRecordsToAdd` — present only when `dnsManaged` is `false`; the MX, SES
  verification TXT, and 3 DKIM CNAME records to add at your DNS provider.

### DNS

- **Route53 (zone id set):** MX, verification TXT, and DKIM CNAMEs are created
  automatically.
- **External DNS:** run `pulumi stack output dnsRecordsToAdd` and add those
  records manually. SES will not deliver mail until the identity is *verified*
  and the MX record resolves.

Verify with:

```bash
dig MX inbox.example.com +short
aws ses get-identity-verification-attributes --identities inbox.example.com
```

## Use

1. Open `appUrl`, enter your email, and copy the forwarding address + RSS URL.
2. Forward an email to the forwarding address.
3. After a minute or two, subscribe to the RSS URL in any podcast app.

## Layout

```
index.ts                composes everything; exports outputs + DNS records
infra/
  database.ts           DynamoDB Users + Episodes
  storage.ts            S3 web / media / incoming buckets + policies
  cdn.ts                CloudFront (OAC) + bucket read policies
  api.ts                HTTP API + register Lambda
  email.ts              SES identity/DKIM + receipt rule + processEmail Lambda + Boson SSM
  dns.ts                Route53 records (or values to add manually)
  lambda.ts             esbuild bundling + Lambda/role factory
handlers/
  register.ts           POST /register
  process-email.ts      SES inbound -> TTS -> episode -> RSS
  shared/               ids, tts (Boson), mime, mp3 duration, rss, dynamo
web/index.html          registration page (API URL injected at deploy)
```

## Notes & limitations

- **Long emails** are truncated before synthesis (`MAX_TTS_CHARS` in
  `handlers/shared/mime.ts`). TODO: chunk + concatenate MP3 segments.
- **Feed privacy** relies on the unguessable feed token in the URL; there is no
  per-feed auth.
- **Confirmation email:** v1 only shows the address/URL on the page. Emailing it
  requires moving SES out of the sandbox (outbound production access).
- **Spam/abuse:** inbound is open to anyone who learns an address. SES spam/virus
  verdicts are available in the receipt and can be enforced in `processEmail` as
  a later hardening step.
- **Cost:** all serverless / pay-per-use (DynamoDB on-demand, Lambda, S3,
  CloudFront PriceClass_100); Boson is free during public preview.

## Teardown

```bash
pulumi destroy
```
