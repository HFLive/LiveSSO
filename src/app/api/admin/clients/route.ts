import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/security/admin";
import { CLIENT_SCOPES, createApprovedClient } from "@/lib/security/client-service";

const inputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  redirectUris: z.array(z.url()).max(20).default([]),
  scopes: z.array(z.enum(CLIENT_SCOPES)).min(1),
  webhookUrl: z.url().optional(),
}).superRefine((value, context) => {
  if (value.scopes.some((scope) => ["openid", "profile", "email", "offline_access"].includes(scope)) && value.redirectUris.length === 0) {
    context.addIssue({ code: "custom", path: ["redirectUris"], message: "Login clients require at least one redirect URI." });
  }
  if (value.redirectUris.some((uri) => URL.canParse(uri) && new URL(uri).hash)) context.addIssue({ code: "custom", path: ["redirectUris"], message: "Redirect URIs cannot contain fragments." });
});

export async function GET() {
  const authorization = await requirePlatformAdmin();
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const clients = await prisma.oauthClient.findMany({
    orderBy: { createdAt: "desc" },
    select: { clientId: true, name: true, disabled: true, approvalStatus: true, scopes: true, redirectUris: true, createdAt: true, updatedAt: true, webhooks: { select: { endpointUrl: true, active: true, eventTypes: true } } },
  });
  return NextResponse.json({ clients });
}

export async function POST(request: Request) {
  const authorization = await requirePlatformAdmin();
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST", details: parsed.error.flatten() }, { status: 400 });
  try {
    const result = await createApprovedClient(prisma, { actorUserId: authorization.actor.id, ...parsed.data });
    return NextResponse.json(result, { status: 201, headers: { "cache-control": "no-store", pragma: "no-cache" } });
  } catch {
    return NextResponse.json({ error: "CLIENT_CREATE_FAILED" }, { status: 400 });
  }
}
