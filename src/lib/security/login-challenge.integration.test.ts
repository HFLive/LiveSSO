import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({ enabled: true, send: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/mail", () => ({ isMailEnabled: () => mail.enabled, sendTransactionalMail: mail.send, sendSecurityNotice: vi.fn().mockResolvedValue(undefined) }));
const suite = process.env.RUN_PHASE3_TESTS === "true" ? describe : describe.skip;

suite("login challenge recovery", () => {
  let database: (typeof import("../prisma"))["prisma"];
  let auth: (typeof import("../auth"))["auth"];
  let service: typeof import("./login-challenge");
  let digest: typeof import("./digest").digestSensitiveValue;
  let userId: string;
  let secret: string;
  const challengeIds: string[] = [];
  const nonce = randomUUID();
  const email = `recovery-${nonce}@example.invalid`;
  beforeAll(async () => {
    await import("dotenv/config");
    ({ prisma: database } = await import("../prisma"));
    ({ auth } = await import("../auth"));
    service = await import("./login-challenge");
    ({ digestSensitiveValue: digest } = await import("./digest"));
    secret = (await import("../env")).getSecurityHashSecret();
    userId = (await database.user.create({ data: { name: "Recovery test", email, emailVerified: true } })).id;
  });
  afterAll(async () => {
    if (!database) return;
    await database.rateLimit.deleteMany({ where: { key: { in: challengeIds.map((id) => `hflive:login-resend:${id}`) } } });
    if (userId) await database.user.deleteMany({ where: { id: userId } });
    await database.$disconnect();
  });
  async function challenge(overrides: Record<string, unknown> = {}) {
    const binding = randomBytes(32).toString("hex");
    const bindingDigest = digest("login-challenge-binding", binding, secret);
    const row = await database.loginChallenge.create({ data: { userId, bindingDigest, otpDigest: digest("login-otp", randomBytes(32).toString("hex"), secret), createdAt: new Date(Date.now() - 65_000), expiresAt: new Date(Date.now() + 8 * 60_000), ...overrides } });
    challengeIds.push(row.id);
    return { ...row, binding };
  }
  function request(path: string, binding?: string, method = "GET", body?: unknown, ip = `2001:db8:${nonce.slice(0, 4)}::82`) {
    return auth.handler(new Request(`http://localhost:3000/api/auth/hflive/challenge/${path}`, { method, headers: { origin: "http://localhost:3000", "x-forwarded-for": ip, "content-type": "application/json", ...(binding ? { cookie: `hflive_login_challenge=${binding}` } : {}) }, ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}) }));
  }
  it("shows only masked context for a valid binding and never caches it", async () => {
    const row = await challenge();
    const missing = await request("status");
    expect(missing.status).toBe(401);
    const response = await request("status", row.binding);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = await response.json();
    expect(data.maskedEmail).toBe("r***@example.invalid");
    expect(data.remainingAttempts).toBe(5);
    expect(Object.keys(data).sort()).toEqual(["serverTime", "canResend", "expiresAt", "maskedEmail", "remainingAttempts", "resendAt"].sort());
  });
  it("serializes concurrent resends and preserves expiry and failed attempts", async () => {
    const row = await challenge({ attemptCount: 2 });
    const results = await Promise.allSettled([1, 2].map(() => service.rotateLoginChallengeOtp(database, { bindingDigest: row.bindingDigest, otpDigest: digest("login-otp", randomUUID(), secret) })));
    expect(results.filter((result) => result.status === "fulfilled").length).toBe(1);
    const stored = await database.loginChallenge.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.expiresAt).toEqual(row.expiresAt);
    expect(stored.attemptCount).toBe(2);
    expect((await database.rateLimit.findUniqueOrThrow({ where: { key: `hflive:login-resend:${row.id}` } })).count).toBe(1);
  });
  it("invalidates the old code, enforces the total resend limit and one-time consumption", async () => {
    const row = await challenge();
    const newDigest = digest("login-otp", randomUUID(), secret);
    await service.rotateLoginChallengeOtp(database, { bindingDigest: row.bindingDigest, otpDigest: newDigest });
    const { consumeLoginChallenge } = await import("./domain-store");
    expect(await consumeLoginChallenge(database, { id: row.id, bindingDigest: row.bindingDigest, otpDigest: row.otpDigest })).toBe(false);
    await database.rateLimit.update({ where: { key: `hflive:login-resend:${row.id}` }, data: { count: 3, lastRequest: BigInt(Date.now() - 65_000) } });
    await expect(service.rotateLoginChallengeOtp(database, { bindingDigest: row.bindingDigest, otpDigest: newDigest })).rejects.toMatchObject({ code: "RESEND_LIMITED" });
    expect(await consumeLoginChallenge(database, { id: row.id, bindingDigest: row.bindingDigest, otpDigest: newDigest })).toBe(true);
    await expect(service.getLoginChallengeStatus(database, row.bindingDigest)).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    await expect(service.rotateLoginChallengeOtp(database, { bindingDigest: row.bindingDigest, otpDigest: newDigest })).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
  });
  it("rejects expired, locked and disabled accounts without exposing their email", async () => {
    for (const [overrides, code] of [[{ expiresAt: new Date(Date.now() - 1) }, "CHALLENGE_EXPIRED"], [{ status: "LOCKED", attemptCount: 5 }, "CHALLENGE_LOCKED"]] as const) {
      const row = await challenge(overrides);
      await expect(service.getLoginChallengeStatus(database, row.bindingDigest)).rejects.toMatchObject({ code });
    }
    const row = await challenge();
    await database.user.update({ where: { id: userId }, data: { accountStatus: "DISABLED" } });
    try {
      const response = await request("status", row.binding);
      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe("INVALID_CHALLENGE");
      await expect(service.rotateLoginChallengeOtp(database, { bindingDigest: row.bindingDigest, otpDigest: row.otpDigest })).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    } finally { await database.user.update({ where: { id: userId }, data: { accountStatus: "ACTIVE" } }); }
  });
  it("restores the previous valid code after a delivery failure while retaining cooldown", async () => {
    const row = await challenge();
    mail.send.mockRejectedValueOnce(new Error("Delivery unavailable"));
    const response = await request("resend", row.binding, "POST");
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("MAIL_DELIVERY_FAILED");
    expect((await database.loginChallenge.findUniqueOrThrow({ where: { id: row.id } })).otpDigest === row.otpDigest).toBe(true);
    const status = await service.getLoginChallengeStatus(database, row.bindingDigest);
    expect(Date.parse(status.resendAt) > Date.now()).toBe(true);
  });
  it("rejects cross-origin resends and returns actionable wrong-code feedback", async () => {
    const row = await challenge();
    const crossOrigin = await auth.handler(new Request("http://localhost:3000/api/auth/hflive/challenge/resend", { method: "POST", headers: { origin: "https://untrusted.example", "content-type": "application/json", cookie: `hflive_login_challenge=${row.binding}` }, body: "{}" }));
    expect(crossOrigin.status).toBe(403);
    const response = await request("verify", row.binding, "POST", { otp: String(Math.floor(Math.random() * 900000) + 100000) }, `2001:db8:${nonce.slice(0, 4)}::83`);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("INVALID_OTP");
  });
  it("cancels pending verification when signing out or switching accounts", async () => {
    const row = await challenge();
    const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-out", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", cookie: `hflive_login_challenge=${row.binding}` }, body: "{}" }));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith("hflive_login_challenge=") && cookie.includes("Max-Age=0"))).toBe(true);
    expect((await database.loginChallenge.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("CANCELLED");
  });
  it("keeps recovery responses indistinguishable during delivery failure or disabled mail", async () => {
    const reset = (address: string, peer = "84") => auth.handler(new Request("http://localhost:3000/api/auth/request-password-reset", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": `2001:db8:${nonce.slice(0, 4)}:${peer}::1` }, body: JSON.stringify({ email: address, redirectTo: "http://localhost:3000/reset-password" }) }));
    mail.send.mockRejectedValueOnce(new Error("Delivery unavailable"));
    const known = await reset(email);
    const unknown = await reset(`unknown-${nonce}@example.invalid`);
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    mail.enabled = false;
    try {
      const disabledKnown = await reset(email, "85");
      const disabledUnknown = await reset(`unknown-${nonce}@example.invalid`, "85");
      expect(disabledKnown.status).toBe(503);
      expect(disabledUnknown.status).toBe(503);
      expect(await disabledKnown.json()).toEqual(await disabledUnknown.json());
    } finally { mail.enabled = true; }
  });
});
