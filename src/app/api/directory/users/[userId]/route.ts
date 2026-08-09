import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeDirectoryRequest } from "@/lib/security/directory-auth";

export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  const caller = await authorizeDirectoryRequest(request, "directory:user:read");
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
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, name: true, image: true, email: true, emailVerified: true, accountStatus: true, updatedAt: true } });
  if (!user) {
    return NextResponse.json(
      { error: "NOT_FOUND" },
      { status: 404, headers: { "cache-control": "private, no-store" } },
    );
  }
  await prisma.auditEvent.create({ data: { eventType: "directory.user.read", actorType: "CLIENT", clientId: caller.clientId, subjectUserId: user.id, outcome: "SUCCESS", expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000) } });
  return NextResponse.json({ subject: user.id, preferredUsername: user.username, name: user.name, picture: user.image, email: user.email, emailVerified: user.emailVerified, status: user.accountStatus, updatedAt: user.updatedAt }, { headers: { "cache-control": "private, no-store" } });
}
