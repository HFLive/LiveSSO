import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { markOutboxPending } from "./outbox-pending";

export const usernameSchema = z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/);
export class UsernameUpdateError extends Error {
  constructor(public code: "INVALID_USERNAME" | "USERNAME_TAKEN" | "USER_NOT_FOUND" | "FORBIDDEN") { super(code); }
}

export async function updateUsername(database: PrismaClient, input: { actorUserId: string; userId: string; username: string }) {
  const parsed = usernameSchema.safeParse(input.username);
  if (!parsed.success) throw new UsernameUpdateError("INVALID_USERNAME");
  const username = parsed.data.toLowerCase();
  const now = new Date();
  const result = await database.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: input.actorUserId } });
    if (actor?.platformRole !== "ADMIN" || actor.accountStatus !== "ACTIVE") throw new UsernameUpdateError("FORBIDDEN");
    const current = await tx.user.findUnique({ where: { id: input.userId } });
    if (!current) throw new UsernameUpdateError("USER_NOT_FOUND");
    if (current.username === username) return { username, changed: false, deliveryCount: 0 };
    const occupied = await tx.user.findFirst({ where: { id: { not: input.userId }, username: { equals: username, mode: "insensitive" } } });
    const reserved = await tx.invitation.findFirst({ where: { username: { equals: username, mode: "insensitive" }, status: "PENDING", expiresAt: { gt: now } } });
    if (occupied || reserved) throw new UsernameUpdateError("USERNAME_TAKEN");
    await tx.user.update({ where: { id: input.userId }, data: { username, displayUsername: parsed.data } });
    const webhooks = await tx.clientWebhook.findMany({ where: { active: true, eventTypes: { has: "user.profile.changed" }, client: { disabled: false, approvalStatus: "APPROVED" } }, select: { id: true, clientId: true } });
    const changeId = randomUUID();
    for (const webhook of webhooks) {
      await tx.outboxEvent.create({ data: {
        aggregateType: "user", aggregateId: input.userId, eventType: "user.profile.changed",
        idempotencyKey: `user-profile:${input.userId}:username:${changeId}:${webhook.id}`,
        payload: { webhookId: webhook.id, clientId: webhook.clientId, subject: input.userId, preferred_username: username, occurredAt: now.toISOString() },
      } });
    }
    await tx.auditEvent.create({ data: {
      eventType: "user.username.changed", actorType: "USER", actorUserId: input.actorUserId, subjectUserId: input.userId,
      outcome: "SUCCESS", metadata: { field: "username", deliveryCount: webhooks.length },
      expiresAt: new Date(now.getTime() + 400 * 24 * 60 * 60 * 1000),
    } });
    return { username, changed: true, deliveryCount: webhooks.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (result.deliveryCount > 0) await markOutboxPending();
  return { id: input.userId, username: result.username, changed: result.changed };
}
