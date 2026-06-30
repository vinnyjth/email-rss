import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

interface CdnArgs {
  web: aws.s3.BucketV2;
  media: aws.s3.BucketV2;
  appHost?: string;
  acmCertArn?: string;
}

/**
 * CloudFront distribution fronting both buckets via Origin Access Control:
 *  - default behavior   -> web bucket (registration site)
 *  - /audio/* , /feeds/* -> media bucket
 * Also attaches the OAC read bucket policies (need the distribution ARN).
 */
export function createCdn(args: CdnArgs) {
  const oac = new aws.cloudfront.OriginAccessControl("oac", {
    originAccessControlOriginType: "s3",
    signingBehavior: "always",
    signingProtocol: "sigv4",
  });

  const webOriginId = "web";
  const mediaOriginId = "media";

  const useCustomDomain = !!(args.appHost && args.acmCertArn);

  const dist = new aws.cloudfront.Distribution("cdn", {
    enabled: true,
    defaultRootObject: "index.html",
    aliases: useCustomDomain ? [args.appHost!] : [],
    origins: [
      {
        originId: webOriginId,
        domainName: args.web.bucketRegionalDomainName,
        originAccessControlId: oac.id,
      },
      {
        originId: mediaOriginId,
        domainName: args.media.bucketRegionalDomainName,
        originAccessControlId: oac.id,
      },
    ],
    defaultCacheBehavior: {
      targetOriginId: webOriginId,
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: ["GET", "HEAD"],
      cachedMethods: ["GET", "HEAD"],
      compress: true,
      forwardedValues: { queryString: false, cookies: { forward: "none" } },
    },
    orderedCacheBehaviors: [
      mediaBehavior("audio/*", mediaOriginId),
      mediaBehavior("feeds/*", mediaOriginId),
    ],
    restrictions: { geoRestriction: { restrictionType: "none" } },
    viewerCertificate: useCustomDomain
      ? {
          acmCertificateArn: args.acmCertArn!,
          sslSupportMethod: "sni-only",
          minimumProtocolVersion: "TLSv1.2_2021",
        }
      : { cloudfrontDefaultCertificate: true },
    priceClass: "PriceClass_100",
  });

  // Grant the distribution OAC read access to each bucket.
  attachOacPolicy("web-oac-policy", args.web, dist.arn);
  attachOacPolicy("media-oac-policy", args.media, dist.arn);

  const cdnDomain = useCustomDomain
    ? pulumi.output(args.appHost!)
    : dist.domainName;

  return { distribution: dist, cdnDomain };
}

function mediaBehavior(
  pathPattern: string,
  targetOriginId: string
): aws.types.input.cloudfront.DistributionOrderedCacheBehavior {
  return {
    pathPattern,
    targetOriginId,
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: ["GET", "HEAD"],
    cachedMethods: ["GET", "HEAD"],
    compress: true,
    forwardedValues: { queryString: false, cookies: { forward: "none" } },
  };
}

function attachOacPolicy(
  name: string,
  bucket: aws.s3.BucketV2,
  distArn: pulumi.Output<string>
) {
  new aws.s3.BucketPolicy(name, {
    bucket: bucket.id,
    policy: pulumi
      .all([bucket.arn, distArn])
      .apply(([bucketArn, arn]) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "AllowCloudFrontOAC",
              Effect: "Allow",
              Principal: { Service: "cloudfront.amazonaws.com" },
              Action: "s3:GetObject",
              Resource: `${bucketArn}/*`,
              Condition: { StringEquals: { "AWS:SourceArn": arn } },
            },
          ],
        })
      ),
  });
}
