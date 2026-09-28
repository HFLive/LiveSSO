import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { markOutboxPending } from "./outbox-pending";

export class IdentityDetailsError extends Error {
  constructor(public code: "USER_NOT_FOUND" | "FORBIDDEN") { super(code); }
}

export async function updateIdentityDetails(database: PrismaClient, input: {
  actorUserId: string;
  userId: string;
  identityLabel: string | null;
  realName: string | null;
}) {
  const now = new Date();
  const result = await database.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: input.actorUserId }, select: { platformRole: true, accountStatus: true } });
    if (actor?.platformRole !== "ADMIN" || actor.accountStatus !== "ACTIVE") throw new IdentityDetailsError("FORBIDDEN");
    const current = await tx.user.findUnique({ where: { id: input.userId }, select: { identityLabel: true, realName: true } });
    if (!current) throw new IdentityDetailsError("USER_NOT_FOUND");
    if (current.identityLabel === input.identityLabel && current.realName === input.realName) return { changed: false, deliveryCount: 0 };
    await tx.user.update({ where: { id: input.userId }, data: { identityLabel: input.identityLabel, realName: input.realName } });
    const webhooks = await tx.clientWebhook.findMany({ where: { active: true, eventTypes: { has: "user.profile.changed" }, client: { disabled: false, approvalStatus: "APPROVED" } }, select: { id: true, clientId: true } });
    const changeId = randomUUID();
    for (const webhook of webhooks) {
      await tx.outboxEvent.create({ data: {
        aggregateType: "user", aggregateId: input.userId, eventType: "user.profile.changed",
        idempotencyKey: `user-profile:${input.userId}:identity:${changeId}:${webhook.id}`,
        payload: { webhookId: webhook.id, clientId: webhook.clientId, subject: input.userId, occurredAt: now.toISOString() },
      } });
    }
    await tx.auditEvent.create({ data: {
      eventType: "user.identity-details.changed", actorType: "USER", actorUserId: input.actorUserId, subjectUserId: input.userId,
      outcome: "SUCCESS", metadata: { fields: ["identityLabel", "realName"], deliveryCount: webhooks.length },
      expiresAt: new Date(now.getTime() + 400 * 24 * 60 * 60 * 1000),
    } });
    return { changed: true, deliveryCount: webhooks.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (result.deliveryCount > 0) await markOutboxPending();
  return { id: input.userId, identityLabel: input.identityLabel, realName: input.realName, changed: result.changed };
}
