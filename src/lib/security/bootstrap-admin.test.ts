import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { createInitialAdmin, repairInitialAdminEmail } from "./bootstrap-admin";

function mockDatabase(existingUsers = 0) {
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    user: {
      count: vi.fn().mockResolvedValue(existingUsers),
      create: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000001" }),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const database = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaClient;
  return { database, transaction };
}

const input = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@example.com",
  username: "initial_admin",
  name: "Initial administrator",
  passwordHash: "hashed-password",
  now: new Date("2026-08-09T00:00:00.000Z"),
};

describe("initial administrator bootstrap", () => {
  it("serializes the empty-database check and creates an audited administrator", async () => {
    const { database, transaction } = mockDatabase();

    await createInitialAdmin(database, input);

    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 15_000,
      timeout: 15_000,
    });
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.user.count.mock.invocationCallOrder[0],
    );
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: input.id,
        email: input.email,
        username: input.username,
        platformRole: "ADMIN",
        accounts: { create: expect.objectContaining({ password: input.passwordHash }) },
      }),
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "platform.admin.bootstrap",
        actorType: "SYSTEM",
        subjectUserId: input.id,
        outcome: "SUCCESS",
        severity: "CRITICAL",
      }),
    });
  });

  it("refuses to create another administrator once any user exists", async () => {
    const { database, transaction } = mockDatabase(1);

    await expect(createInitialAdmin(database, input)).rejects.toThrow(
      "Initial administrator creation is locked because the database already contains a user.",
    );
    expect(transaction.user.create).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid administrator email before starting a transaction", async () => {
    const { database } = mockDatabase();

    await expect(createInitialAdmin(database, { ...input, email: "not-an-email" })).rejects.toThrow(
      "Initial administrator email must be a valid email address.",
    );
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});

function mockRepairDatabase(existingEmail = "'admin@example.com'") {
  const administrator = {
    id: input.id,
    email: existingEmail,
    platformRole: "ADMIN",
    accountStatus: "ACTIVE",
  };
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    user: {
      findMany: vi.fn().mockResolvedValue([administrator]),
      update: vi.fn().mockResolvedValue({ ...administrator, email: "admin@example.com" }),
    },
    loginChallenge: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    auditEvent: {
      findFirst: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000002" }),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const database = {
    $transaction: vi.fn(async (callback) => callback(transaction)),
  } as unknown as PrismaClient;
  return { database, transaction };
}

describe("initial administrator email repair", () => {
  it("repairs only the malformed bootstrap administrator and audits the change", async () => {
    const { database, transaction } = mockRepairDatabase();

    await repairInitialAdminEmail(database, { email: "Admin@Example.com", now: input.now });

    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 15_000,
      timeout: 15_000,
    });
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: input.id },
      data: { email: "admin@example.com", emailVerified: true },
    });
    expect(transaction.loginChallenge.updateMany).toHaveBeenCalledWith({
      where: { userId: input.id, status: "PENDING" },
      data: { status: "CANCELLED", cancelledAt: input.now },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "platform.admin.bootstrap_email_repaired",
        actorType: "SYSTEM",
        subjectUserId: input.id,
        outcome: "SUCCESS",
        severity: "CRITICAL",
        metadata: expect.objectContaining({ cancelledChallenges: 2 }),
      }),
    });
  });

  it("refuses to replace an already valid administrator email", async () => {
    const { database, transaction } = mockRepairDatabase("admin@example.com");

    await expect(repairInitialAdminEmail(database, { email: "new@example.com" })).rejects.toThrow(
      "Initial administrator email repair refuses to replace an already valid email address.",
    );
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(transaction.auditEvent.create).not.toHaveBeenCalled();
  });
});
