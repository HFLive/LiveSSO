import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/security/admin";

export async function GET() {
  const authorization = await requirePlatformAdmin();
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, username: true, identityLabel: true, realName: true, email: true, platformRole: true, accountStatus: true, createdAt: true } });
  return NextResponse.json({ users });
}
