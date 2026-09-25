import { Prisma, type PrismaClient } from "@/generated/prisma/client";

export class InvitationManagementError extends Error {
  constructor(public code: "FORBIDDEN" | "INVITATION_NOT_PENDING") { super(code); }
}

export async function listInvitations(database: PrismaClient) {
  const now = new Date();
  const [pending, recent] = await Promise.all([
    database.invitation.findMany({
      where: { status: "PENDING", expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, username: true, status: true, createdAt: true, expiresAt: true, acceptedAt: true, revokedAt: true },
    }),
    database.invitation.findMany({
      where: { OR: [{ status: { not: "PENDING" } }, { expiresAt: { lte: now } }] },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, email: true, username: true, status: true, createdAt: true, expiresAt: true, acceptedAt: true, revokedAt: true },
    }),
  ]);
  const unique = new Map([...pending, ...recent].map((item) => [item.id, item]));
  return [...unique.values()].map((item) => ({
    ...item,
    status: item.status === "PENDING" && item.expiresAt <= now ? "EXPIRED" as const : item.status,
  }));
}

export async function revokeInvitation(database: PrismaClient, input: { actorUserId: string; invitationId: string }) {
  const now = new Date();
  return database.$transaction(async (transaction) => {
    const actor = await transaction.user.findUnique({
      where: { id: input.actorUserId },
      select: { platformRole: true, accountStatus: true },
    });
    if (actor?.platformRole !== "ADMIN" || actor.accountStatus !== "ACTIVE") throw new InvitationManagementError("FORBIDDEN");
    const changed = await transaction.invitation.updateMany({
      where: { id: input.invitationId, status: "PENDING", expiresAt: { gt: now }, acceptedAt: null, revokedAt: null },
      data: { status: "REVOKED", revokedAt: now },
    });
    if (changed.count !== 1) throw new InvitationManagementError("INVITATION_NOT_PENDING");
    await transaction.auditEvent.create({ data: {
      eventType: "invitation.revoked", actorType: "USER", actorUserId: input.actorUserId,
      outcome: "SUCCESS", metadata: { invitationId: input.invitationId },
      expiresAt: new Date(now.getTime() + 400 * 24 * 60 * 60 * 1_000),
    } });
    return { id: input.invitationId, status: "REVOKED" as const, revokedAt: now };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
