import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { putUser } from "./shared/dynamo";
import { token } from "./shared/ids";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function reply(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  if (event.requestContext.http.method === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  let email: string;
  try {
    const parsed = JSON.parse(event.body || "{}");
    email = String(parsed.email || "").trim().toLowerCase();
  } catch {
    return reply(400, { error: "Invalid JSON body" });
  }

  if (!EMAIL_RE.test(email)) {
    return reply(400, { error: "A valid email is required" });
  }

  const inboxDomain = process.env.INBOX_DOMAIN!;
  const cdnDomain = process.env.CDN_DOMAIN!;

  const forwardingToken = token();
  const feedId = token();

  await putUser({
    forwardingToken,
    feedId,
    email,
    createdAt: new Date().toISOString(),
  });

  return reply(200, {
    forwardAddress: `${forwardingToken}@${inboxDomain}`,
    rssUrl: `https://${cdnDomain}/feeds/${feedId}.xml`,
  });
};
