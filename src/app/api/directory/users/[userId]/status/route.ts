import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeDirectoryRequest } from "@/lib/security/directory-auth";

export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  const caller = await authorizeDirectoryRequest(request, "directory:user:status");
  if (!caller) {
    return NextResponse.json(
      { error: "INVALID_TOKEN" },
      {
        status: 401,
        headers: {
          "cache-control": "private, no-store",
          "www-authenticate": 'Bearer error="invalid_token"',
        },
      },
    );
  }
  const { userId } = await context.params;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, accountStatus: true, updatedAt: true } });
  if (!user) {
    return NextResponse.json(
      { error: "NOT_FOUND" },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    );
  }
  return NextResponse.json({ subject: user.id, status: user.accountStatus, updatedAt: user.updatedAt }, { headers: { "cache-control": "private, no-store" } });
}
