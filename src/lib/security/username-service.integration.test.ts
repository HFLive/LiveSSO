import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateUsername } from "./username-service";

const suite = process.env.RUN_USERNAME_TESTS === "true" ? describe : describe.skip;
suite("admin username changes with PostgreSQL", () => {
  let db: (typeof import("../prisma"))["prisma"];
  let auth: (typeof import("../auth"))["auth"];
  let adminId: string, userId: string, otherId: string, clientId: string;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const oldName = `old_${suffix}`, newName = `new_${suffix}`, taken = `taken_${suffix}`;
  const password = randomBytes(24).toString("base64url");
  const change = (username: string, actorUserId = adminId, id = userId) => updateUsername(db, { actorUserId, userId: id, username });
  beforeAll(async () => {
    await import("dotenv/config");
    ({ prisma: db } = await import("../prisma"));
    ({ auth } = await import("../auth"));
    const { hashPassword } = await import("better-auth/crypto");
    adminId = (await db.user.create({ data: { name: "Username QA admin", email: `admin-${suffix}@example.invalid`, platformRole: "ADMIN" } })).id;
    userId = (await db.user.create({ data: { name: "Username QA", email: `${suffix}@example.invalid`, username: oldName, emailVerified: true, accounts: { create: { providerId: "credential", accountId: suffix, password: await hashPassword(password) } } } })).id;
    otherId = (await db.user.create({ data: { name: "Other", email: `other-${suffix}@example.invalid`, username: taken } })).id;
    const { createApprovedClient } = await import("./client-service");
    ({ clientId } = await createApprovedClient(db, { actorUserId: adminId, name: "Username QA", redirectUris: ["http://127.0.0.1:4100/callback"], scopes: ["openid", "profile"], webhookUrl: "http://127.0.0.1:4100/webhook" }));
  });
  afterAll(async () => {
    if (!db) return;
    await db.outboxEvent.deleteMany({ where: { aggregateId: { in: [userId, otherId] } } });
    await db.invitation.deleteMany({ where: { normalizedEmail: `reserved-${suffix}@example.invalid` } });
    if (clientId) await db.oauthClient.delete({ where: { clientId } });
    await db.user.deleteMany({ where: { id: { in: [adminId, userId, otherId] } } });
    await db.$disconnect();
  });
  it("rejects invalid names and non-admin actors", async () => {
    for (const name of ["ab", "a".repeat(33), "bad-name", "中文名", "a@b.com"]) await expect(change(name)).rejects.toMatchObject({ code: "INVALID_USERNAME" });
    await expect(change(newName, otherId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.user.update({ where: { id: adminId }, data: { accountStatus: "DISABLED" } });
    await expect(change(newName)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.user.update({ where: { id: adminId }, data: { accountStatus: "ACTIVE" } });
    await expect(change(newName, adminId, randomUUID())).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });
  it("rejects case-insensitive conflicts and pending invitations", async () => {
    await expect(change(taken.toUpperCase())).rejects.toMatchObject({ code: "USERNAME_TAKEN" });
    await db.invitation.create({ data: { email: `reserved-${suffix}@example.invalid`, normalizedEmail: `reserved-${suffix}@example.invalid`, username: newName.toUpperCase(), tokenDigest: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
    await expect(change(newName)).rejects.toMatchObject({ code: "USERNAME_TAKEN" });
    await db.invitation.updateMany({ where: { normalizedEmail: `reserved-${suffix}@example.invalid` }, data: { createdAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 60_000) } });
  });
  it("changes username atomically, preserves identity, and emits audit and profile events", async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await change(` ${newName.toUpperCase()} `)).toMatchObject({ id: userId, username: newName, changed: true });
    const after = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after).toMatchObject({ id: before.id, email: before.email, name: before.name, platformRole: before.platformRole, username: newName, displayUsername: newName.toUpperCase() });
    expect(await db.auditEvent.count({ where: { eventType: "user.username.changed", actorUserId: adminId, subjectUserId: userId } })).toBe(1);
    const event = await db.outboxEvent.findFirstOrThrow({ where: { aggregateId: userId, eventType: "user.profile.changed" } });
    expect(event.payload).toMatchObject({ subject: userId, preferred_username: newName });
    expect(await change(newName)).toMatchObject({ changed: false });
    expect(await db.auditEvent.count({ where: { eventType: "user.username.changed", subjectUserId: userId } })).toBe(1);
  });
  it("accepts the new login and email, rejects the old login", async () => {
    for (const [identifier, status] of [[oldName, 401], [newName.toUpperCase(), 200], [`${suffix}@example.invalid`, 200]] as const) {
      const response = await auth.handler(new Request("http://localhost:3000/api/auth/hflive/sign-in", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ identifier, password }) }));
      expect(response.status).toBe(status);
    }
  });
  it("allows only one concurrent claim of a username", async () => {
    const shared = `shared_${suffix}`;
    const results = await Promise.allSettled([change(shared), change(shared, adminId, otherId)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.user.count({ where: { username: shared } })).toBe(1);
  });
});
