import { createHash, createPublicKey, verify } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export async function authorizeDirectoryRequest(request: Request, requiredScope: string) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3) {
    const stored = await prisma.oauthAccessToken.findUnique({
      where: { token: createHash("sha256").update(token).digest("base64url") },
      select: { clientId: true, userId: true, scopes: true, expiresAt: true, revoked: true, oauthclient: { select: { disabled: true, approvalStatus: true, scopes: true, grantTypes: true } } },
    });
    if (!stored || stored.userId || stored.revoked || (stored.expiresAt && stored.expiresAt <= new Date()) || stored.oauthclient.disabled || stored.oauthclient.approvalStatus !== "APPROVED" || !stored.scopes.includes(requiredScope) || !stored.oauthclient.scopes.includes(requiredScope) || !stored.oauthclient.grantTypes.includes("client_credentials")) return null;
    return { clientId: stored.clientId, scopes: stored.scopes };
  }
  let payload: Record<string, unknown>;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { kid?: string; alg?: string; typ?: string };
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    if (!header.kid || header.alg !== "EdDSA") return null;
    const jwk = await prisma.jwks.findUnique({ where: { id: header.kid }, select: { publicKey: true, expiresAt: true } });
    if (!jwk || (jwk.expiresAt && jwk.expiresAt.getTime() + 30 * 24 * 60 * 60 * 1_000 <= Date.now())) return null;
    const publicKey = createPublicKey({ key: JSON.parse(jwk.publicKey), format: "jwk" });
    if (!verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], "base64url"))) return null;
    const now = Math.floor(Date.now() / 1_000);
    const issuer = getServerEnv().BETTER_AUTH_URL;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.sid !== undefined) return null;
    // 1.7 sets the machine subject to the client ID. Legacy tokens omit it.
    if (payload.sub !== undefined && (
      header.typ !== "at+jwt" || typeof payload.sub !== "string" ||
      payload.sub !== payload.azp || payload.sub !== payload.client_id
    )) return null;
    if (payload.iss !== issuer || !audiences.includes(issuer) || typeof payload.exp !== "number" || payload.exp <= now || (typeof payload.nbf === "number" && payload.nbf > now)) return null;
  } catch {
    return null;
  }
  const clientId = typeof payload?.azp === "string" ? payload.azp : null;
  const scopes = typeof payload?.scope === "string" ? payload.scope.split(" ") : [];
  if (!clientId || !scopes.includes(requiredScope)) return null;
  const client = await prisma.oauthClient.findUnique({
    where: { clientId },
    select: { disabled: true, approvalStatus: true, scopes: true, grantTypes: true },
  });
  if (!client || client.disabled || client.approvalStatus !== "APPROVED" || !client.scopes.includes(requiredScope) || !client.grantTypes.includes("client_credentials")) return null;
  return { clientId, scopes };
}
