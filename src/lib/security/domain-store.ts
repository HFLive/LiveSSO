import { Prisma, type OutboxEvent, type PlatformRole, type PrismaClient } from "../../generated/prisma/client";

type DatabaseClient = Prisma.TransactionClient;

const ADMIN_AUDIT_RETENTION_MS = 400 * 24 * 60 * 60 * 1_000;

export async function setPlatformRole(
  database: PrismaClient,
  input: { actorUserId: string; subjectUserId: string; role: PlatformRole; requestId?: string; now?: Date },
) {
  const now = input.now ?? new Date();

  return database.$transaction(async (transaction) => {
    const actor = await transaction.$queryRaw<Array<{ platformRole: PlatformRole }>>(Prisma.sql`
      SELECT "platformRole"
        FROM "user"
       WHERE "id" = ${input.actorUserId}::uuid
       FOR UPDATE
    `);
    const authorized = actor[0]?.platformRole === "ADMIN";

    if (!authorized) {
      await transaction.auditEvent.create({
        data: {
          eventType: "platform.role.change",
          actorType: "USER",
          actorUserId: input.actorUserId,
          subjectUserId: input.subjectUserId,
          outcome: "DENIED",
          severity: "WARNING",
          requestId: input.requestId,
          metadata: { requestedRole: input.role },
          expiresAt: new Date(now.getTime() + ADMIN_AUDIT_RETENTION_MS),
        },
      });
      return false;
    }

    const updated = await transaction.user.updateMany({
      where: { id: input.subjectUserId },
      data: { platformRole: input.role },
    });
    if (updated.count !== 1) {
      throw new Error("The role subject does not exist.");
    }

    await transaction.auditEvent.create({
      data: {
        eventType: "platform.role.change",
        actorType: "USER",
        actorUserId: input.actorUserId,
        subjectUserId: input.subjectUserId,
        outcome: "SUCCESS",
        severity: "CRITICAL",
        requestId: input.requestId,
        metadata: { assignedRole: input.role },
        expiresAt: new Date(now.getTime() + ADMIN_AUDIT_RETENTION_MS),
      },
    });

    return true;
  });
}

export async function consumeInvitation(
  database: DatabaseClient,
  input: { id: string; tokenDigest: string; acceptedById: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const result = await database.invitation.updateMany({
    where: {
      id: input.id,
      tokenDigest: input.tokenDigest,
      status: "PENDING",
      expiresAt: { gt: now },
      acceptedAt: null,
      revokedAt: null,
    },
    data: {
      status: "ACCEPTED",
      acceptedById: input.acceptedById,
      acceptedAt: now,
    },
  });

  return result.count === 1;
}

export async function expireStaleInvitations(
  database: DatabaseClient,
  now = new Date(),
) {
  const result = await database.invitation.updateMany({
    where: { status: "PENDING", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });

  return result.count;
}

export async function consumeLoginChallenge(
  database: DatabaseClient,
  input: { id: string; bindingDigest: string; otpDigest: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const result = await database.loginChallenge.updateMany({
    where: {
      id: input.id,
      bindingDigest: input.bindingDigest,
      otpDigest: input.otpDigest,
      status: "PENDING",
      expiresAt: { gt: now },
      attemptCount: { lt: database.loginChallenge.fields.maxAttempts },
      consumedAt: null,
      cancelledAt: null,
    },
    data: {
      status: "CONSUMED",
      consumedAt: now,
    },
  });

  return result.count === 1;
}

export async function recordLoginChallengeFailure(
  database: DatabaseClient,
  input: { id: string; bindingDigest: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const rows = await database.$queryRaw<Array<{ attemptCount: number; status: "PENDING" | "LOCKED" }>>(Prisma.sql`
    UPDATE "loginChallenge"
       SET "attemptCount" = "attemptCount" + 1,
           "status" = CASE
             WHEN "attemptCount" + 1 >= "maxAttempts" THEN 'LOCKED'::"LoginChallengeStatus"
             ELSE 'PENDING'::"LoginChallengeStatus"
           END,
           "updatedAt" = ${now}
     WHERE "id" = ${input.id}::uuid
       AND "bindingDigest" = ${input.bindingDigest}
       AND "status" = 'PENDING'::"LoginChallengeStatus"
       AND "expiresAt" > ${now}
       AND "attemptCount" < "maxAttempts"
     RETURNING "attemptCount", "status"
  `);

  return rows[0] ?? null;
}

export type ClaimedOutboxEvent = OutboxEvent & { leaseId: string };

export async function claimOutboxEvents(
  database: DatabaseClient,
  input: { limit: number; leaseDurationMs: number; now?: Date },
) {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new Error("Outbox claim limit must be an integer between 1 and 100.");
  }

  if (!Number.isInteger(input.leaseDurationMs) || input.leaseDurationMs < 1_000 || input.leaseDurationMs > 15 * 60_000) {
    throw new Error("Outbox lease duration must be between 1 second and 15 minutes.");
  }

  const now = input.now ?? new Date();
  const lockedUntil = new Date(now.getTime() + input.leaseDurationMs);

  return database.$queryRaw<ClaimedOutboxEvent[]>(Prisma.sql`
    WITH candidates AS (
      SELECT "id"
        FROM "outboxEvent"
       WHERE "attemptCount" < "maxAttempts"
         AND (
           ("status" = 'PENDING'::"OutboxStatus" AND "availableAt" <= ${now})
           OR
           ("status" = 'PROCESSING'::"OutboxStatus" AND "lockedUntil" <= ${now})
         )
       ORDER BY "availableAt" ASC, "createdAt" ASC
       FOR UPDATE SKIP LOCKED
       LIMIT ${input.limit}
    )
    UPDATE "outboxEvent" AS event
       SET "status" = 'PROCESSING'::"OutboxStatus",
           "attemptCount" = event."attemptCount" + 1,
           "leaseId" = pg_catalog.gen_random_uuid(),
           "lockedAt" = ${now},
           "lockedUntil" = ${lockedUntil},
           "updatedAt" = ${now}
      FROM candidates
     WHERE event."id" = candidates."id"
     RETURNING event.*
  `);
}

export async function completeOutboxEvent(
  database: DatabaseClient,
  input: { id: string; leaseId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const result = await database.outboxEvent.updateMany({
    where: { id: input.id, leaseId: input.leaseId, status: "PROCESSING" },
    data: {
      status: "DELIVERED",
      deliveredAt: now,
      leaseId: null,
      lockedAt: null,
      lockedUntil: null,
      lastErrorCode: null,
    },
  });

  return result.count === 1;
}

export async function failOutboxEvent(
  database: DatabaseClient,
  input: { id: string; leaseId: string; retryAt: Date; errorCode: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const rows = await database.$queryRaw<Array<{ status: "PENDING" | "DEAD_LETTER" }>>(Prisma.sql`
    UPDATE "outboxEvent"
       SET "status" = CASE
             WHEN "attemptCount" >= "maxAttempts" THEN 'DEAD_LETTER'::"OutboxStatus"
             ELSE 'PENDING'::"OutboxStatus"
           END,
           "availableAt" = ${input.retryAt},
           "leaseId" = NULL,
           "lockedAt" = NULL,
           "lockedUntil" = NULL,
           "lastErrorCode" = ${input.errorCode},
           "updatedAt" = ${now}
     WHERE "id" = ${input.id}::uuid
       AND "leaseId" = ${input.leaseId}::uuid
       AND "status" = 'PROCESSING'::"OutboxStatus"
     RETURNING "status"
  `);

  return rows[0]?.status ?? null;
}
