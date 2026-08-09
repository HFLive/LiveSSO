import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import * as z from "zod";

const ADMIN_AUDIT_RETENTION_MS = 400 * 24 * 60 * 60 * 1_000;
const ADMIN_EMAIL_SCHEMA = z.email().max(254);

function normalizeAdminEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!ADMIN_EMAIL_SCHEMA.safeParse(email).success) {
    throw new Error("Initial administrator email must be a valid email address.");
  }
  return email;
}

export async function createInitialAdmin(
  database: PrismaClient,
  input: {
    id: string;
    email: string;
    username: string;
    name: string;
    passwordHash: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const email = normalizeAdminEmail(input.email);

  await database.$transaction(
    async (transaction) => {
      await transaction.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
        SELECT 1 AS "locked"
          FROM (SELECT pg_advisory_xact_lock(121256, 1)) AS bootstrap_lock
      `);

      if ((await transaction.user.count()) > 0) {
        throw new Error(
          "Initial administrator creation is locked because the database already contains a user.",
        );
      }

      await transaction.user.create({
        data: {
          id: input.id,
          name: input.name,
          email,
          emailVerified: true,
          username: input.username,
          displayUsername: input.username,
          platformRole: "ADMIN",
          accounts: {
            create: {
              accountId: input.id,
              providerId: "credential",
              password: input.passwordHash,
            },
          },
        },
      });

      await transaction.auditEvent.create({
        data: {
          eventType: "platform.admin.bootstrap",
          actorType: "SYSTEM",
          subjectUserId: input.id,
          outcome: "SUCCESS",
          severity: "CRITICAL",
          metadata: { method: "initial-user-command" },
          createdAt: now,
          expiresAt: new Date(now.getTime() + ADMIN_AUDIT_RETENTION_MS),
        },
      });
    },
    {
      maxWait: 15_000,
      timeout: 15_000,
    },
  );
}

export async function repairInitialAdminEmail(
  database: PrismaClient,
  input: { email: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const email = normalizeAdminEmail(input.email);

  await database.$transaction(
    async (transaction) => {
      await transaction.$queryRaw<Array<{ locked: number }>>(Prisma.sql`
        SELECT 1 AS "locked"
          FROM (SELECT pg_advisory_xact_lock(121256, 1)) AS bootstrap_lock
      `);

      const users = await transaction.user.findMany({
        take: 2,
        select: {
          id: true,
          email: true,
          platformRole: true,
          accountStatus: true,
        },
      });
      if (users.length !== 1) {
        throw new Error("Initial administrator email repair requires exactly one database user.");
      }

      const administrator = users[0];
      const bootstrapAudit = await transaction.auditEvent.findFirst({
        where: {
          eventType: "platform.admin.bootstrap",
          actorType: "SYSTEM",
          outcome: "SUCCESS",
          subjectUserId: administrator.id,
        },
        select: { id: true },
      });
      if (
        administrator.platformRole !== "ADMIN" ||
        administrator.accountStatus !== "ACTIVE" ||
        !bootstrapAudit
      ) {
        throw new Error("Initial administrator email repair could not verify the bootstrap administrator.");
      }
      if (ADMIN_EMAIL_SCHEMA.safeParse(administrator.email).success) {
        throw new Error("Initial administrator email repair refuses to replace an already valid email address.");
      }

      await transaction.user.update({
        where: { id: administrator.id },
        data: { email, emailVerified: true },
      });
      const cancelledChallenges = await transaction.loginChallenge.updateMany({
        where: { userId: administrator.id, status: "PENDING" },
        data: { status: "CANCELLED", cancelledAt: now },
      });
      await transaction.auditEvent.create({
        data: {
          eventType: "platform.admin.bootstrap_email_repaired",
          actorType: "SYSTEM",
          subjectUserId: administrator.id,
          outcome: "SUCCESS",
          severity: "CRITICAL",
          metadata: {
            method: "initial-admin-email-repair-command",
            cancelledChallenges: cancelledChallenges.count,
          },
          createdAt: now,
          expiresAt: new Date(now.getTime() + ADMIN_AUDIT_RETENTION_MS),
        },
      });
    },
    {
      maxWait: 15_000,
      timeout: 15_000,
    },
  );
}
