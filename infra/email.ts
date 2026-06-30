import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { makeHandler } from "./lambda";

interface EmailArgs {
  inboxDomain: string; // inbox.<domain>
  incoming: aws.s3.BucketV2;
  incomingSesPolicy: pulumi.Resource; // ensure SES write policy exists first
  media: aws.s3.BucketV2;
  usersTable: aws.dynamodb.Table;
  episodesTable: aws.dynamodb.Table;
  cdnDomain: pulumi.Input<string>;
  bosonApiKey: pulumi.Input<string>;
  ttsVoice: pulumi.Input<string>;
}

const INCOMING_PREFIX = "raw/";

/**
 * SES inbound: verify the inbox subdomain, set up DKIM, and a receipt rule that
 * (1) writes raw MIME to S3, then (2) invokes the processEmail Lambda.
 */
export function createEmail(args: EmailArgs) {
  const accountId = aws.getCallerIdentityOutput().accountId;

  // Boson API key in SSM Parameter Store (SecureString).
  const bosonParam = new aws.ssm.Parameter("boson-api-key", {
    type: "SecureString",
    value: args.bosonApiKey,
  });

  // SES identity + DKIM for the inbox subdomain.
  const identity = new aws.ses.DomainIdentity("inbox-identity", {
    domain: args.inboxDomain,
  });
  const dkim = new aws.ses.DomainDkim("inbox-dkim", {
    domain: identity.domain,
  });

  // processEmail Lambda.
  const fn = makeHandler({
    name: "process-email",
    entry: "process-email.ts",
    // Boson's free preview is slow (~35s/chunk) and we retry on 5xx, so allow
    // ample headroom for a few sequential chunk syntheses.
    timeout: 300,
    memory: 512,
    environment: {
      INCOMING_BUCKET: args.incoming.bucket,
      INCOMING_PREFIX,
      MEDIA_BUCKET: args.media.bucket,
      CDN_DOMAIN: args.cdnDomain,
      INBOX_DOMAIN: args.inboxDomain,
      USERS_TABLE: args.usersTable.name,
      EPISODES_TABLE: args.episodesTable.name,
      BOSON_API_KEY_PARAM: bosonParam.name,
      TTS_VOICE: args.ttsVoice,
    },
    policy: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "dynamodb:GetItem",
          Resource: args.usersTable.arn,
        },
        {
          Effect: "Allow",
          Action: ["dynamodb:PutItem", "dynamodb:Query"],
          Resource: args.episodesTable.arn,
        },
        {
          Effect: "Allow",
          Action: "s3:GetObject",
          Resource: pulumi.interpolate`${args.incoming.arn}/*`,
        },
        {
          Effect: "Allow",
          Action: "s3:PutObject",
          Resource: pulumi.interpolate`${args.media.arn}/*`,
        },
        {
          Effect: "Allow",
          Action: "ssm:GetParameter",
          Resource: bosonParam.arn,
        },
      ],
    },
  });

  // Allow SES to invoke processEmail.
  new aws.lambda.Permission("process-email-ses-perm", {
    action: "lambda:InvokeFunction",
    function: fn.name,
    principal: "ses.amazonaws.com",
    sourceAccount: accountId,
  });

  // Receipt rule set + rule.
  const ruleSet = new aws.ses.ReceiptRuleSet("rule-set", {
    ruleSetName: "email-rss-rules",
  });

  const rule = new aws.ses.ReceiptRule(
    "inbound-rule",
    {
      ruleSetName: ruleSet.ruleSetName,
      recipients: [args.inboxDomain], // catch-all for the subdomain
      enabled: true,
      scanEnabled: true,
      tlsPolicy: "Optional",
      s3Actions: [
        {
          position: 1,
          bucketName: args.incoming.bucket,
          objectKeyPrefix: INCOMING_PREFIX,
        },
      ],
      lambdaActions: [
        {
          position: 2,
          functionArn: fn.arn,
          invocationType: "Event",
        },
      ],
    },
    {
      // SES validates S3 write access at create time; ensure the bucket policy
      // and the Lambda permission exist first.
      dependsOn: [args.incomingSesPolicy],
    }
  );

  new aws.ses.ActiveReceiptRuleSet("active-rule-set", {
    ruleSetName: ruleSet.ruleSetName,
  });

  return { identity, dkim, processEmail: fn, rule };
}
