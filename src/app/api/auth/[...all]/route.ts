import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);
const JWKS_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=300";

function withCacheControl(response: Response, value: string) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/oauth2/authorize")) {
    const clientId = url.searchParams.get("client_id");
    const redirectUri = url.searchParams.get("redirect_uri");
    const requestedScopes = (url.searchParams.get("scope") ?? "").split(" ").filter(Boolean);
    const client = clientId ? await prisma.oauthClient.findUnique({
      where: { clientId },
      select: { disabled: true, approvalStatus: true, redirectUris: true, scopes: true },
    }) : null;
    if (!client || client.disabled || client.approvalStatus !== "APPROVED") {
      return Response.json({ error: "invalid_client" }, { status: 400 });
    }
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      return Response.json({ error: "invalid_request", error_description: "redirect_uri is not registered" }, { status: 400 });
    }
    if (requestedScopes.some((scope) => !client.scopes.includes(scope))) {
      return Response.json({ error: "invalid_scope" }, { status: 400 });
    }
  }
  const response = await handlers.GET(request);
  if (url.pathname.endsWith("/jwks") && response.ok) {
    return withCacheControl(response, JWKS_CACHE_CONTROL);
  }
  return response;
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (
    new URL(request.url).pathname !== "/api/auth/oauth2/token" ||
    contentType !== "application/x-www-form-urlencoded" ||
    request.headers.has("authorization")
  ) {
    return handlers.POST(request);
  }

  const form = new URLSearchParams(await request.clone().text());
  const [grant, secondGrant] = form.getAll("grant_type");
  const [clientId, secondClientId] = form.getAll("client_id");
  const [secret, secondSecret] = form.getAll("client_secret");
  if (
    (grant !== "authorization_code" && grant !== "refresh_token") ||
    !clientId || !secret ||
    secondGrant !== undefined || secondClientId !== undefined || secondSecret !== undefined ||
    form.has("client_assertion") || form.has("client_assertion_type")
  ) {
    return handlers.POST(request);
  }

  const client = await prisma.oauthClient.findUnique({
    where: { clientId },
    select: { approvalStatus: true, disabled: true, public: true, tokenEndpointAuthMethod: true },
  });
  if (
    !client || client.approvalStatus !== "APPROVED" || client.disabled || client.public ||
    (client.tokenEndpointAuthMethod ?? "client_secret_basic") !== "client_secret_basic"
  ) {
    return handlers.POST(request);
  }

  // LiveBoard's existing login clients use POST with Basic registrations.
  // Preserve that wire format while the provider still verifies the shared secret.
  const encode = (value: string) => new URLSearchParams([["", value]]).toString().slice(1);
  const credentials = Buffer.from(`${encode(clientId)}:${encode(secret)}`).toString("base64");
  const headers = new Headers(request.headers);
  headers.set("authorization", `Basic ${credentials}`);
  headers.delete("content-length");
  form.delete("client_id");
  form.delete("client_secret");
  return handlers.POST(new Request(request.url, {
    method: "POST",
    headers,
    body: form,
    signal: request.signal,
  }));
}
export const PATCH = handlers.PATCH;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
