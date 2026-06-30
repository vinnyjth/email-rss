import * as path from "path";
import * as fs from "fs";
import * as esbuild from "esbuild";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

/**
 * Bundle a single handler with esbuild into dist/<name>/index.js and return it
 * as a Pulumi asset archive. Runs synchronously at `pulumi up` time, so there is
 * no separate build step. The AWS SDK v3 ships with the Node 20 runtime, so it
 * is marked external to keep bundles small.
 */
export function bundle(name: string, entry: string): pulumi.asset.AssetArchive {
  const outdir = path.join(DIST, name);
  fs.mkdirSync(outdir, { recursive: true });
  const outfile = path.join(outdir, "index.js");

  esbuild.buildSync({
    entryPoints: [path.join(ROOT, "handlers", entry)],
    outfile,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: false,
    minify: false,
    external: ["@aws-sdk/*"],
  });

  return new pulumi.asset.AssetArchive({
    "index.js": new pulumi.asset.FileAsset(outfile),
  });
}

export interface HandlerArgs {
  name: string;
  entry: string; // file under handlers/, e.g. "register.ts"
  policy: aws.iam.PolicyDocument;
  environment: pulumi.Input<Record<string, pulumi.Input<string>>>;
  timeout?: number;
  memory?: number;
}

/** Create a Node 20 Lambda with a least-privilege inline role policy. */
export function makeHandler(args: HandlerArgs): aws.lambda.Function {
  const role = new aws.iam.Role(`${args.name}-role`, {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: { Service: "lambda.amazonaws.com" },
        },
      ],
    }),
  });

  new aws.iam.RolePolicyAttachment(`${args.name}-logs`, {
    role: role.name,
    policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
  });

  new aws.iam.RolePolicy(`${args.name}-policy`, {
    role: role.id,
    // The policy's Resource fields are unresolved Outputs (ARNs); deeply resolve
    // them before serializing — JSON.stringify alone would corrupt the Outputs.
    policy: pulumi.output(args.policy).apply((p) => JSON.stringify(p)),
  });

  return new aws.lambda.Function(args.name, {
    runtime: aws.lambda.Runtime.NodeJS20dX,
    handler: "index.handler",
    role: role.arn,
    code: bundle(args.name, args.entry),
    timeout: args.timeout ?? 30,
    memorySize: args.memory ?? 256,
    environment: { variables: args.environment },
  });
}
