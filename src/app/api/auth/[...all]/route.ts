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

export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
