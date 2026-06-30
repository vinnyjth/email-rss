import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const USERS_TABLE = () => required("USERS_TABLE");
const EPISODES_TABLE = () => required("EPISODES_TABLE");

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} env var not set`);
  return v;
}

export interface User {
  forwardingToken: string;
  email: string;
  feedId: string;
  createdAt: string;
}

export interface Episode {
  feedId: string;
  /** `<epochMillis>#<guid>` — sorts chronologically. */
  sortKey: string;
  guid: string;
  title: string;
  summary: string;
  audioKey: string;
  bytes: number;
  durationSec: number;
  pubDate: string; // RFC 822 / RFC 2822
}

export async function putUser(user: User): Promise<void> {
  await doc.send(new PutCommand({ TableName: USERS_TABLE(), Item: user }));
}

export async function getUserByToken(
  forwardingToken: string
): Promise<User | undefined> {
  const res = await doc.send(
    new GetCommand({ TableName: USERS_TABLE(), Key: { forwardingToken } })
  );
  return res.Item as User | undefined;
}

export async function putEpisode(ep: Episode): Promise<void> {
  await doc.send(new PutCommand({ TableName: EPISODES_TABLE(), Item: ep }));
}

/** Newest-first list of episodes for a feed. */
export async function listEpisodes(
  feedId: string,
  limit = 200
): Promise<Episode[]> {
  const res = await doc.send(
    new QueryCommand({
      TableName: EPISODES_TABLE(),
      KeyConditionExpression: "feedId = :f",
      ExpressionAttributeValues: { ":f": feedId },
      ScanIndexForward: false, // descending sortKey -> newest first
      Limit: limit,
    })
  );
  return (res.Items as Episode[]) ?? [];
}
