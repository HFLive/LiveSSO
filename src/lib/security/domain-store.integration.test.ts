import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  claimOutboxEvents,
  completeOutboxEvent,
  consumeInvitation,
  consumeLoginChallenge,
  recordLoginChallengeFailure,
} from "./domain-store";

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "true";
const suite = runDatabaseTests ? describe : describe.skip;

suite("Phase 2 database concurrency", () => {
  let database: PrismaClient;
  const runId = randomUUID();
  const testDigest = (purpose: string) => `h1:${createHash("sha256").update(`${runId}:${purpose}`).digest("hex")}`;
  let userId: string;

  beforeAll(async () => {
    await import("dotenv/config");
    ({ prisma: database } = await import("../prisma"));
    const user = await database.user.create({
      data: {
        name: "Phase 2 integration test",
        email: `phase2-${runId}@example.invalid`,
        emailVerified: true,
        username: `p2_${runId.replaceAll("-", "").slice(0, 20)}`,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (!database) return;

    await database.outboxEvent.deleteMany({ where: { idempotencyKey: { startsWith: `test:${runId}:` } } });
    if (userId) await database.user.delete({ where: { id: userId } });
    await database.$disconnect();
  });

  it("allows an invitation to be consumed exactly once", async () => {
    const tokenDigest = testDigest("invitation");
    const invitation = await database.invitation.create({
      data: {
        email: `phase2-${runId}@example.invalid`,
        normalizedEmail: `phase2-${runId}@example.invalid`,
        tokenDigest,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        consumeInvitation(database, { id: invitation.id, tokenDigest, acceptedById: userId }),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("allows a valid login challenge to be consumed exactly once", async () => {
    const bindingDigest = testDigest("binding");
    const otpDigest = testDigest("otp");
    const challenge = await database.loginChallenge.create({
      data: {
        userId,
        bindingDigest,
        otpDigest,
        riskReasons: ["new_device"],
        riskScore: 10,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        consumeLoginChallenge(database, { id: challenge.id, bindingDigest, otpDigest }),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("rejects a valid login challenge after the account is disabled", async () => {
    const bindingDigest = testDigest("disabled-binding");
    const otpDigest = testDigest("disabled-otp");
    const challenge = await database.loginChallenge.create({
      data: {
        userId,
        bindingDigest,
        otpDigest,
        riskReasons: ["new_device"],
        riskScore: 20,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await database.user.update({ where: { id: userId }, data: { accountStatus: "DISABLED" } });
    try {
      expect(await consumeLoginChallenge(database, { id: challenge.id, bindingDigest, otpDigest })).toBe(false);
    } finally {
      await database.user.update({ where: { id: userId }, data: { accountStatus: "ACTIVE" } });
    }
  });

  it("locks a challenge at its attempt limit under concurrent failures", async () => {
    const bindingDigest = testDigest("failure-binding");
    const challenge = await database.loginChallenge.create({
      data: {
        userId,
        bindingDigest,
        otpDigest: testDigest("failure-otp"),
        riskReasons: ["repeated_failure"],
        riskScore: 30,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        recordLoginChallengeFailure(database, { id: challenge.id, bindingDigest }),
      ),
    );
    const stored = await database.loginChallenge.findUniqueOrThrow({ where: { id: challenge.id } });

    expect(results.filter((result) => result !== null)).toHaveLength(5);
    expect(stored.attemptCount).toBe(5);
    expect(stored.status).toBe("LOCKED");
  });

  it("leases each outbox row to at most one concurrent claimant", async () => {
    await database.outboxEvent.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        aggregateType: "user",
        aggregateId: userId,
        eventType: "user.profile.changed",
        idempotencyKey: `test:${runId}:${index}`,
        payload: { userId, index },
      })),
    });

    const [first, second] = await Promise.all([
      claimOutboxEvents(database, { limit: 6, leaseDurationMs: 30_000 }),
      claimOutboxEvents(database, { limit: 6, leaseDurationMs: 30_000 }),
    ]);
    const firstIds = new Set(first.map((event) => event.id));
    const secondIds = new Set(second.map((event) => event.id));

    expect(first).toHaveLength(6);
    expect(second).toHaveLength(6);
    expect([...firstIds].filter((id) => secondIds.has(id))).toHaveLength(0);
    expect(new Set([...firstIds, ...secondIds])).toHaveLength(12);
    expect([...first, ...second].every((event) => event.leaseId !== null)).toBe(true);

    const event = first[0];
    const completions = await Promise.all([
      completeOutboxEvent(database, { id: event.id, leaseId: event.leaseId }),
      completeOutboxEvent(database, { id: event.id, leaseId: event.leaseId }),
    ]);
    expect(completions.filter(Boolean)).toHaveLength(1);
  });
});
