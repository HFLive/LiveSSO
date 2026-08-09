import { Prisma, type PrismaClient } from "../../generated/prisma/client";

const ADMIN_AUDIT_RETENTION_MS = 400 * 24 * 60 * 60 * 1_000;

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
          email: input.email,
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
