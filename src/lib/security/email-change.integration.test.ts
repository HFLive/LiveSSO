import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requestEmailChange, confirmEmailChange, cancelEmailChange } from "./email-change-service";

vi.mock("@/lib/mail", () => ({
  isMailEnabled: () => false,
  sendTransactionalMail: vi.fn(async () => undefined),
  sendSecurityNotice: vi.fn(async () => undefined),
}));

const suite = process.env.RUN_EMAIL_CHANGE_TESTS === "true" ? describe : describe.skip;
suite("email changes with PostgreSQL and auth endpoints", () => {
  let db: (typeof import("../prisma"))["prisma"];
  let auth: (typeof import("../auth"))["auth"];
  let userId: string;
  let cookie: string;
  const prefix = randomUUID();
  const password = randomBytes(24).toString("base64url");
  const oldEmail = `old-${prefix}@example.invalid`;
  const email = (tag: string) => `${tag}-${prefix}@example.invalid`;
  const digest = (tag: string) => `test-digest-${tag}-${prefix}`;
  const send = async (action: string, body: unknown, session = cookie, origin = "http://localhost:3000") => auth.handler(new Request(`http://localhost:3000/api/auth/hflive/profile/email/${action}`, {
    method: "POST", headers: { "content-type": "application/json", origin, cookie: session, "x-forwarded-for": "192.0.2.89" }, body: JSON.stringify(body),
  }));
  beforeAll(async () => {
    await import("dotenv/config");
    ({ prisma: db } = await import("../prisma"));
    ({ auth } = await import("../auth"));
    const context = await auth.$context;
    context.skipCSRFCheck = false;
    context.skipOriginCheck = false;
    const { hashPassword } = await import("better-auth/crypto");
    const user = await db.user.create({ data: { name: "Email test", email: oldEmail, emailVerified: true,
      accounts: { create: { providerId: "credential", accountId: oldEmail, password: await hashPassword(password) } },
    } });
    userId = user.id;
    await db.rateLimit.deleteMany({ where: { key: { contains: "192.0.2.89" } } });
    const response = await auth.handler(new Request("http://localhost:3000/api/auth/hflive/sign-in", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ identifier: oldEmail, password }),
    }));
    expect(response.status).toBe(200);
    cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  });
  afterAll(async () => {
    if (userId) await db.user.delete({ where: { id: userId } });
    await db?.$disconnect();
  });
  it("rejects unauthenticated, cross-origin, and wrong-password requests", async () => {
    expect((await send("request", { newEmail: email("api"), password }, "")).status).toBe(401);
    expect((await send("request", { newEmail: email("api"), password }, cookie, "https://untrusted.invalid")).status).toBe(403);
    expect((await send("request", { newEmail: email("api"), password: "wrong" })).status).toBe(401);
    expect(await db.emailChangeRequest.count({ where: { userId } })).toBe(0);
  });
  it("sends a code without changing email; confirms once and notifies old email", async () => {
    const { sendTransactionalMail, sendSecurityNotice } = await import("../mail");
    expect((await send("request", { newEmail: email("api"), password })).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe(oldEmail);
    const mail = vi.mocked(sendTransactionalMail).mock.calls.at(-1)![0];
    const otp = /验证码是 (\d{6})/.exec(mail.text)![1];
    const row = await db.emailChangeRequest.findFirstOrThrow({ where: { userId, status: "PENDING" } });
    expect(row.otpDigest.includes(otp)).toBe(false);
    expect((await send("confirm", { otp })).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe(email("api"));
    expect(vi.mocked(sendSecurityNotice).mock.calls.at(-1)![0]).toBe(oldEmail);
    expect((await send("confirm", { otp })).status).toBe(400);
    for (const [identifier, expectedStatus] of [[oldEmail, 401], [email("api"), 200]] as const) {
      const login = await auth.handler(new Request("http://localhost:3000/api/auth/hflive/sign-in", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ identifier, password }),
      }));
      expect(login.status).toBe(expectedStatus);
    }
  });
  it("locks after five failures, cancels, expires, and replaces old requests", async () => {
    await requestEmailChange(db, { userId, newEmail: email("lock"), otpDigest: digest("lock") });
    for (let i = 0; i < 5; i++) await expect(confirmEmailChange(db, { userId, otpDigest: digest("wrong") })).rejects.toMatchObject({ code: "INVALID_OTP" });
    expect(await db.emailChangeRequest.count({ where: { userId, status: "LOCKED", attemptCount: 5 } })).toBe(1);
    await requestEmailChange(db, { userId, newEmail: email("cancel"), otpDigest: digest("cancel") });
    await cancelEmailChange(db, { userId });
    await expect(confirmEmailChange(db, { userId, otpDigest: digest("cancel") })).rejects.toMatchObject({ code: "NO_PENDING_REQUEST" });
    await requestEmailChange(db, { userId, newEmail: email("expired"), otpDigest: digest("expired"), now: new Date(Date.now() - 700_000) });
    await expect(confirmEmailChange(db, { userId, otpDigest: digest("expired") })).rejects.toMatchObject({ code: "NO_PENDING_REQUEST" });
    await requestEmailChange(db, { userId, newEmail: email("first"), otpDigest: digest("first") });
    await requestEmailChange(db, { userId, newEmail: email("second"), otpDigest: digest("second") });
    await expect(confirmEmailChange(db, { userId, otpDigest: digest("first") })).rejects.toMatchObject({ code: "INVALID_OTP" });
  });
  it("rolls back consumption on conflict and only one concurrent confirmation succeeds", async () => {
    const other = await db.user.create({ data: { name: "conflict", email: email("other") } });
    try {
      await requestEmailChange(db, { userId, newEmail: email("race"), otpDigest: digest("race") });
      await db.user.update({ where: { id: other.id }, data: { email: email("race") } });
      await expect(confirmEmailChange(db, { userId, otpDigest: digest("race") })).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
      expect(await db.emailChangeRequest.count({ where: { userId, status: "PENDING" } })).toBe(1);
      await db.user.update({ where: { id: other.id }, data: { email: email("other") } });
      const results = await Promise.allSettled([confirmEmailChange(db, { userId, otpDigest: digest("race") }), confirmEmailChange(db, { userId, otpDigest: digest("race") })]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect((await db.account.findFirstOrThrow({ where: { userId, providerId: "credential" } })).accountId).toBe(email("race"));
    } finally { await db.user.delete({ where: { id: other.id } }); }
  });
  it("rejects inactive users and invited addresses and writes outbox with the committed profile", async () => {
    const invitation = await db.invitation.create({ data: { email: email("reserved"), normalizedEmail: email("reserved"), tokenDigest: digest("invitation"), expiresAt: new Date(Date.now() + 60_000) } });
    await expect(requestEmailChange(db, { userId, newEmail: email("reserved"), otpDigest: digest("reserved") })).rejects.toMatchObject({ code: "EMAIL_RESERVED" });
    await db.invitation.delete({ where: { id: invitation.id } });
    await requestEmailChange(db, { userId, newEmail: email("outbox"), otpDigest: digest("outbox") });
    await db.user.update({ where: { id: userId }, data: { accountStatus: "DISABLED" } });
    await expect(confirmEmailChange(db, { userId, otpDigest: digest("outbox") })).rejects.toMatchObject({ code: "ACCOUNT_NOT_ACTIVE" });
    await db.user.update({ where: { id: userId }, data: { accountStatus: "ACTIVE" } });
    const { createApprovedClient } = await import("./client-service");
    const client = await createApprovedClient(db, { actorUserId: userId, name: "Email test subscriber", redirectUris: [], scopes: ["directory:user:read"], webhookUrl: "https://example.invalid/webhook" });
    try {
      await db.verification.create({ data: { identifier: `reset-password:${prefix}`, value: userId, expiresAt: new Date(Date.now() + 60_000) } });
      await db.loginChallenge.create({ data: { userId, bindingDigest: digest("binding"), otpDigest: digest("login"), riskReasons: ["new_device"], expiresAt: new Date(Date.now() + 60_000) } });
      await confirmEmailChange(db, { userId, otpDigest: digest("outbox") });
      const event = await db.outboxEvent.findFirstOrThrow({ where: { aggregateId: userId, eventType: "user.profile.changed" } });
      expect(event.payload).toMatchObject({ subject: userId, email: email("outbox"), clientId: client.clientId });
      expect(await db.auditEvent.count({ where: { subjectUserId: userId, eventType: "user.email.changed" } })).toBeGreaterThan(0);
      expect(await db.verification.count({ where: { value: userId } })).toBe(0);
      expect(await db.loginChallenge.count({ where: { userId, status: "PENDING" } })).toBe(0);
    } finally {
      await db.outboxEvent.deleteMany({ where: { aggregateId: userId } });
      await db.oauthClient.delete({ where: { clientId: client.clientId } });
    }
  });
  it("cancels requests when delivery fails and applies persistent rate limits", async () => {
    const { sendTransactionalMail } = await import("../mail");
    vi.mocked(sendTransactionalMail).mockRejectedValueOnce(new Error("unavailable"));
    expect((await send("request", { newEmail: email("failure"), password })).status).toBe(502);
    expect(await db.emailChangeRequest.count({ where: { userId, status: "PENDING" } })).toBe(0);
    let response: Response | undefined;
    for (let i = 0; i < 6; i++) response = await send("request", { newEmail: email("limited"), password });
    expect(response?.status).toBe(429);
  });
});
