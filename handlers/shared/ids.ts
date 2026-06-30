import { randomBytes, randomUUID } from "crypto";

/**
 * Unguessable, case-insensitive token. 16 bytes -> 32 lowercase hex chars
 * (128 bits). Hex (not base64url) because the token is used as an email
 * local-part, and many mail systems lowercase the local-part in transit — a
 * case-sensitive token would then fail to match on lookup.
 */
export function token(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

/** RFC 4122 UUID, used as an episode guid. */
export function guid(): string {
  return randomUUID();
}
