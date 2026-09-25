import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/security/admin";
import { InvitationManagementError, revokeInvitation } from "@/lib/security/invitation-management";

export async function DELETE(request: Request, context: { params: Promise<{ invitationId: string }> }) {
  const authorization = await requirePlatformAdmin();
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  const { invitationId } = await context.params;
  if (!z.uuid().safeParse(invitationId).success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  try {
    return NextResponse.json(await revokeInvitation(prisma, { actorUserId: authorization.actor.id, invitationId }));
  } catch (error) {
    if (error instanceof InvitationManagementError) return NextResponse.json({ error: error.code }, { status: error.code === "FORBIDDEN" ? 403 : 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "RETRY_UPDATE" }, { status: 409 });
    return NextResponse.json({ error: "INVITATION_UPDATE_FAILED" }, { status: 500 });
  }
}
