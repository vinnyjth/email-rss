import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

interface DnsArgs {
  zoneId: string; // "" if the zone is not in Route53
  region: pulumi.Input<string>;
  inboxDomain: string; // inbox.<domain>
  identity: aws.ses.DomainIdentity;
  dkim: aws.ses.DomainDkim;
}

/**
 * When the hosted zone is in Route53, create the MX (inbound), SES verification
 * TXT, and 3 DKIM CNAME records. Otherwise, export the values to add manually.
 */
export function createDns(args: DnsArgs) {
  const mxValue = pulumi.interpolate`10 inbound-smtp.${args.region}.amazonaws.com`;

  // Records to surface for manual setup (always computed).
  const manual = {
    mx: { name: args.inboxDomain, type: "MX", value: mxValue },
    verificationTxt: {
      name: `_amazonses.${args.inboxDomain}`,
      type: "TXT",
      value: args.identity.verificationToken,
    },
    dkimCnames: [0, 1, 2].map((i) => ({
      name: args.dkim.dkimTokens.apply((t) => `${t[i]}._domainkey.${args.inboxDomain}`),
      type: "CNAME",
      value: args.dkim.dkimTokens.apply((t) => `${t[i]}.dkim.amazonses.com`),
    })),
  };

  if (!args.zoneId) {
    return { managed: false as const, manual };
  }

  new aws.route53.Record("mx", {
    zoneId: args.zoneId,
    name: args.inboxDomain,
    type: "MX",
    ttl: 300,
    records: [mxValue],
  });

  new aws.route53.Record("ses-verification", {
    zoneId: args.zoneId,
    name: `_amazonses.${args.inboxDomain}`,
    type: "TXT",
    ttl: 600,
    records: [args.identity.verificationToken],
  });

  [0, 1, 2].forEach((i) => {
    new aws.route53.Record(`dkim-${i}`, {
      zoneId: args.zoneId,
      name: args.dkim.dkimTokens.apply((t) => `${t[i]}._domainkey.${args.inboxDomain}`),
      type: "CNAME",
      ttl: 600,
      records: [args.dkim.dkimTokens.apply((t) => `${t[i]}.dkim.amazonses.com`)],
    });
  });

  return { managed: true as const, manual };
}
