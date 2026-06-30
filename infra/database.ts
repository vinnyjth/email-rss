import * as aws from "@pulumi/aws";

/** DynamoDB tables: Users (by forwarding token) and Episodes (by feedId). */
export function createTables() {
  const users = new aws.dynamodb.Table("users", {
    billingMode: "PAY_PER_REQUEST",
    hashKey: "forwardingToken",
    attributes: [{ name: "forwardingToken", type: "S" }],
    pointInTimeRecovery: { enabled: true },
  });

  const episodes = new aws.dynamodb.Table("episodes", {
    billingMode: "PAY_PER_REQUEST",
    hashKey: "feedId",
    rangeKey: "sortKey",
    attributes: [
      { name: "feedId", type: "S" },
      { name: "sortKey", type: "S" },
    ],
    pointInTimeRecovery: { enabled: true },
  });

  return { users, episodes };
}
