import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/security/admin";
import { getClientWebhookStatus } from "@/lib/security/client-service";

export async function GET(_request: Request, context: { params: Promise<{ clientId: string }> }) {
  const authorization = await requirePlatformAdmin();
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { clientId } = await context.params;
  const status = await getClientWebhookStatus(prisma, clientId);
  if (!status) return NextResponse.json({ error: "WEBHOOK_NOT_FOUND" }, { status: 404 });
  return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
}
