import { createHmac, timingSafeEqual } from "node:crypto";

const DIGEST_VERSION = "h1";

export type DigestPurpose =
  | "invitation-token"
  | "trusted-device-token"
  | "login-challenge-binding"
  | "login-otp"
  | "email-change-otp"
  | "ip-address"
  | "user-agent";

export function digestSensitiveValue(purpose: DigestPurpose, value: string, secret: string) {
  if (value.length === 0) {
    throw new Error("Cannot digest an empty sensitive value.");
  }

  if (secret.length < 32) {
    throw new Error("The digest secret must contain at least 32 characters.");
  }

  const digest = createHmac("sha256", secret)
    .update(`hflive-auth:${DIGEST_VERSION}:${purpose}\0`, "utf8")
    .update(value, "utf8")
    .digest("hex");

  return `${DIGEST_VERSION}:${digest}`;
}

export function digestMatches(candidate: string, expectedDigest: string, purpose: DigestPurpose, secret: string) {
  const actualDigest = digestSensitiveValue(purpose, candidate, secret);
  const actual = Buffer.from(actualDigest, "utf8");
  const expected = Buffer.from(expectedDigest, "utf8");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
