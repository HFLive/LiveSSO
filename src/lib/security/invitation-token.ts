import { z } from "zod";
import { getSecurityHashSecret } from "@/lib/env";
import { digestSensitiveValue } from "@/lib/security/digest";

const invitationIdSchema = z.uuid();
const rawTokenSchema = z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/);

export function parseInvitationToken(token: string) {
  if (token.length < 20 || token.length > 200) return null;
  const separator = token.indexOf(".");
  if (separator < 1) return null;
  const id = token.slice(0, separator);
  const rawToken = token.slice(separator + 1);
  if (!invitationIdSchema.safeParse(id).success || !rawTokenSchema.safeParse(rawToken).success) {
    return null;
  }
  return {
    id,
    tokenDigest: digestSensitiveValue(
      "invitation-token",
      rawToken,
      getSecurityHashSecret(),
    ),
  };
}
