import type { PrismaClient } from "@/generated/prisma/client";

export async function getLoginApplication(database: PrismaClient, currentURL: string) {
  const current = new URL(currentURL);
  let request = current;
  const callback = current.searchParams.get("callbackURL");
  if (callback) {
    try { request = new URL(callback, current.origin); } catch { return undefined; }
    if (request.origin !== current.origin || request.username || request.password || request.pathname !== "/api/auth/oauth2/authorize") return undefined;
  }
  const clientId = request.searchParams.get("client_id");
  const redirectUri = request.searchParams.get("redirect_uri");
  if (!clientId || clientId.length > 255 || !redirectUri || request.searchParams.get("response_type") !== "code") return undefined;
  const client = await database.oauthClient.findUnique({ where: { clientId }, select: { name: true, disabled: true, approvalStatus: true, redirectUris: true, scopes: true } });
  const scopes = (request.searchParams.get("scope") ?? "").split(" ").filter(Boolean);
  if (!client || client.disabled || client.approvalStatus !== "APPROVED" || !client.redirectUris.includes(redirectUri) || scopes.some((scope) => !client.scopes.includes(scope))) return undefined;
  return client.name?.trim() || undefined;
}
