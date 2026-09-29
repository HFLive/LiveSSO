import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { markOutboxPending } from "./outbox-pending";

export const usernameSchema = z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/);
export class UsernameUpdateError extends Error {
  constructor(public code: "INVALID_USERNAME" | "USERNAME_TAKEN" | "USER_NOT_FOUND" | "FORBIDDEN" | "INVALID_PASSWORD") { super(code); }
}

export async function updateUsername(database: PrismaClient, input: { actorUserId: string; userId: string; username: string }) {
  return changeUsername(database, { ...input, mode: "admin" });
}

export async function updateOwnUsername(database: PrismaClient, input: { userId: string; username: string; password: string }) {
  return changeUsername(database, { ...input, actorUserId: input.userId, mode: "self" });
}

export async function consumeOwnUsernameAttempt(database: PrismaClient, userId: string) {
  const now = BigInt(Date.now());
  const windowStart = now - 10n * 60n * 1000n;
  const key = `profile-username:${userId}`;
  const [attempt] = await database.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    INSERT INTO "rateLimit" ("id", "key", "count", "lastRequest")
    VALUES (gen_random_uuid(), ${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rateLimit"."lastRequest" < ${windowStart} THEN 1 ELSE "rateLimit"."count" + 1 END,
      "lastRequest" = ${now}
    RETURNING "count"
  `);
  return (attempt?.count ?? 6) <= 5;
}

async function changeUsername(database: PrismaClient, input: { actorUserId: string; userId: string; username: string; mode: "admin" | "self"; password?: string }) {
  const parsed = usernameSchema.safeParse(input.username);
  if (!parsed.success) throw new UsernameUpdateError("INVALID_USERNAME");
  const username = parsed.data.toLowerCase();
  const now = new Date();
  const result = await database.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: input.actorUserId } });
    if (!actor || actor.accountStatus !== "ACTIVE" || (input.mode === "admin" && actor.platformRole !== "ADMIN")) throw new UsernameUpdateError("FORBIDDEN");
    if (input.mode === "self") {
      const account = await tx.account.findFirst({ where: { userId: input.userId, providerId: "credential" }, select: { password: true } });
      const valid = account?.password
        ? await verifyPassword({ hash: account.password, password: input.password ?? "" })
        : (await hashPassword(input.password ?? ""), false);
      if (!valid) throw new UsernameUpdateError("INVALID_PASSWORD");
    }
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
