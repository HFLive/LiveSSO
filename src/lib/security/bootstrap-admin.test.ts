import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import { createInitialAdmin } from "./bootstrap-admin";

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
  email: "admin@example.invalid",
  username: "initial_admin",
  name: "Initial administrator",
  passwordHash: "hashed-password",
  now: new Date("2026-08-09T00:00:00.000Z"),
};

describe("initial administrator bootstrap", () => {
  it("serializes the empty-database check and creates an audited administrator", async () => {
    const { database, transaction } = mockDatabase();

    await createInitialAdmin(database, input);

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
});
