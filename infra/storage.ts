import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

/**
 * Three private buckets:
 *  - web:      static registration site (served only via CloudFront OAC)
 *  - media:    generated MP3 audio + RSS XML (served only via CloudFront OAC)
 *  - incoming: raw inbound MIME from SES (7-day lifecycle, SES-write only)
 *
 * CloudFront OAC bucket policies are attached in cdn.ts (they need the
 * distribution ARN). The SES-write policy on `incoming` is attached here.
 */
export function createBuckets() {
  const web = privateBucket("web");
  const media = privateBucket("media");

  const incoming = new aws.s3.BucketV2("incoming", {});
  new aws.s3.BucketPublicAccessBlock("incoming-pab", {
    bucket: incoming.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });
  new aws.s3.BucketLifecycleConfigurationV2("incoming-lifecycle", {
    bucket: incoming.id,
    rules: [
      {
        id: "expire-raw-email",
        status: "Enabled",
        filter: { prefix: "raw/" },
        expiration: { days: 7 },
      },
    ],
  });

  // Allow SES inbound to write raw MIME into the incoming bucket.
  const accountId = aws.getCallerIdentityOutput().accountId;
  const incomingSesPolicy = new aws.s3.BucketPolicy("incoming-ses-policy", {
    bucket: incoming.id,
    policy: pulumi
      .all([incoming.arn, accountId])
      .apply(([arn, account]) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "AllowSESPuts",
              Effect: "Allow",
              Principal: { Service: "ses.amazonaws.com" },
              Action: "s3:PutObject",
              Resource: `${arn}/*`,
              Condition: { StringEquals: { "aws:SourceAccount": account } },
            },
          ],
        })
      ),
  });

  return { web, media, incoming, incomingSesPolicy };
}

function privateBucket(name: string): aws.s3.BucketV2 {
  const b = new aws.s3.BucketV2(name, {});
  new aws.s3.BucketPublicAccessBlock(`${name}-pab`, {
    bucket: b.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  });
  return b;
}
