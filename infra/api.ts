import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { makeHandler } from "./lambda";

interface ApiArgs {
  usersTable: aws.dynamodb.Table;
  inboxDomain: pulumi.Input<string>;
  cdnDomain: pulumi.Input<string>;
}

/** HTTP API with a single `POST /register` route backed by the register Lambda. */
export function createApi(args: ApiArgs) {
  const fn = makeHandler({
    name: "register",
    entry: "register.ts",
    environment: {
      USERS_TABLE: args.usersTable.name,
      INBOX_DOMAIN: args.inboxDomain,
      CDN_DOMAIN: args.cdnDomain,
    },
    policy: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "dynamodb:PutItem",
          Resource: args.usersTable.arn,
        },
      ],
    },
  });

  const api = new aws.apigatewayv2.Api("http-api", {
    protocolType: "HTTP",
    corsConfiguration: {
      allowOrigins: ["*"],
      allowMethods: ["POST", "OPTIONS"],
      allowHeaders: ["content-type"],
    },
  });

  const integration = new aws.apigatewayv2.Integration("register-integration", {
    apiId: api.id,
    integrationType: "AWS_PROXY",
    integrationUri: fn.arn,
    payloadFormatVersion: "2.0",
  });

  new aws.apigatewayv2.Route("register-route", {
    apiId: api.id,
    routeKey: "POST /register",
    target: pulumi.interpolate`integrations/${integration.id}`,
  });

  const stage = new aws.apigatewayv2.Stage("default-stage", {
    apiId: api.id,
    name: "$default",
    autoDeploy: true,
  });

  new aws.lambda.Permission("register-apigw-perm", {
    action: "lambda:InvokeFunction",
    function: fn.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: pulumi.interpolate`${api.executionArn}/*/*`,
  });

  return { api, apiUrl: stage.invokeUrl };
}
