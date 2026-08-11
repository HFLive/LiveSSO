import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const suite = process.env.RUN_PHASE3_TESTS === "true" ? describe : describe.skip;

suite("Phase 3 credential and risk login integration", () => {
  let auth: (typeof import("../auth"))["auth"];
  let database: (typeof import("../prisma"))["prisma"];
  let digest: typeof import("./digest").digestSensitiveValue;
  let secret: string;
  const runId = randomUUID();
  const email = `phase3-${runId}@example.invalid`;
  const username = `p3_${runId.replaceAll("-", "").slice(0, 20)}`;
  const password = "Phase3-test-password-2026";
  let userId: string;
  let invitedUserId: string | undefined;
  let assignedInvitationId: string | undefined;
  const reusableInvitationIds: string[] = [];

  beforeAll(async () => {
    await import("dotenv/config");
    ({ auth } = await import("../auth"));
    ({ prisma: database } = await import("../prisma"));
    ({ digestSensitiveValue: digest } = await import("./digest"));
    const { getSecurityHashSecret } = await import("../env");
    secret = getSecurityHashSecret();
    const { hashPassword } = await import("better-auth/crypto");
    const user = await database.user.create({
      data: {
        name: "Phase 3 integration test",
        email,
        emailVerified: true,
        username,
        accounts: { create: { providerId: "credential", accountId: email, password: await hashPassword(password) } },
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (!database) return;
    if (assignedInvitationId) {
      await database.invitation.deleteMany({ where: { id: assignedInvitationId } });
    }
    if (reusableInvitationIds.length) {
      await database.invitation.deleteMany({ where: { id: { in: reusableInvitationIds } } });
    }
    if (invitedUserId) {
      await database.user.deleteMany({ where: { id: invitedUserId } });
    }
    if (userId) await database.user.delete({ where: { id: userId } });
    await database.$disconnect();
  });

  function signIn(cookie?: string, overrides?: { identifier?: string; password?: string; ip?: string }) {
    return auth.handler(new Request("http://localhost:3000/api/auth/hflive/sign-in", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "user-agent": "phase3-integration",
        "x-forwarded-for": overrides?.ip ?? "192.0.2.30",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ identifier: overrides?.identifier ?? username, password: overrides?.password ?? password }),
    }));
  }

  it("creates a session directly for a stable trusted device", async () => {
    const raw = `trusted-${runId}`;
    const ipDigest = digest("ip-address", "192.0.2.30", secret);
    await database.trustedDevice.create({
      data: {
        userId,
        tokenDigest: digest("trusted-device-token", raw, secret),
        userAgentDigest: digest("user-agent", "phase3-integration", secret),
        firstIpDigest: ipDigest,
        lastIpDigest: ipDigest,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const response = await signIn(`hflive_trusted_device=${raw}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ authenticated: true });
    expect(response.headers.get("set-cookie")).toContain("better-auth.session_token");
  });

  it("requires and consumes an email OTP for a new device", async () => {
    const response = await signIn();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ challengeRequired: true });
    const setCookie = response.headers.get("set-cookie") ?? "";
    const binding = /hflive_login_challenge=([^;]+)/.exec(setCookie)?.[1];
    expect(binding).toBeTruthy();

    let otp: string | undefined;
    for (let attempt = 0; attempt < 20 && !otp; attempt += 1) {
      const listing = await fetch("http://localhost:58025/api/v1/messages").then((result) => result.json()) as {
        messages: Array<{ ID: string; To: Array<{ Address: string }> }>;
      };
      const message = listing.messages.find((candidate) => candidate.To.some((recipient) => recipient.Address === email));
      if (message) {
        const detail = await fetch(`http://localhost:58025/api/v1/message/${message.ID}`).then((result) => result.json()) as { Text?: string };
        otp = /\b(\d{6})\b/.exec(detail.Text ?? "")?.[1];
      }
      if (!otp) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(otp).toMatch(/^\d{6}$/);

    const verified = await auth.handler(new Request("http://localhost:3000/api/auth/hflive/challenge/verify", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: `hflive_login_challenge=${binding}` },
      body: JSON.stringify({ otp, trustDevice: true }),
    }));
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ authenticated: true });
    expect(verified.headers.get("set-cookie")).toContain("better-auth.session_token");
    expect(await database.loginChallenge.count({ where: { userId, status: "CONSUMED" } })).toBe(1);
  });

  it("reserves and enforces the username assigned by an invitation", async () => {
    const rawToken = `assigned-${runId}`;
    const assignedUsername = `Assigned_${runId.replaceAll("-", "").slice(0, 16)}`;
    const invitation = await database.invitation.create({
      data: {
        email: `assigned-${runId}@example.invalid`,
        normalizedEmail: `assigned-${runId}@example.invalid`,
        username: assignedUsername,
        tokenDigest: digest("invitation-token", rawToken, secret),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    assignedInvitationId = invitation.id;

    await expect(
      database.invitation.create({
        data: {
          email: `duplicate-${runId}@example.invalid`,
          normalizedEmail: `duplicate-${runId}@example.invalid`,
          username: assignedUsername.toLowerCase(),
          tokenDigest: digest("invitation-token", `duplicate-${runId}`, secret),
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();

    const { POST } = await import("../../app/api/invitations/accept/route");
    const response = await POST(
      new Request("http://localhost:3000/api/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: `${invitation.id}.${rawToken}`,
          username: "browser_tampering",
          name: "Assigned invitation user",
          password,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const created = await database.user.findUniqueOrThrow({
      where: { email: `assigned-${runId}@example.invalid` },
    });
    invitedUserId = created.id;
    expect(created.username).toBe(assignedUsername.toLowerCase());
    expect(created.displayUsername).toBe(assignedUsername);
  });

  it("releases an unaccepted username after its invitation expires", async () => {
    const { expireStaleInvitations } = await import("./domain-store");
    const reusableUsername = `Reusable_${runId.replaceAll("-", "").slice(0, 16)}`;
    const expired = await database.invitation.create({
      data: {
        email: `expired-${runId}@example.invalid`,
        normalizedEmail: `expired-${runId}@example.invalid`,
        username: reusableUsername,
        tokenDigest: digest("invitation-token", `expired-${runId}`, secret),
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1_000),
        expiresAt: new Date(Date.now() - 60 * 60 * 1_000),
      },
    });
    reusableInvitationIds.push(expired.id);

    expect(await expireStaleInvitations(database)).toBeGreaterThanOrEqual(1);
    expect(
      await database.invitation.findUniqueOrThrow({ where: { id: expired.id } }),
    ).toMatchObject({ status: "EXPIRED" });

    const replacement = await database.invitation.create({
      data: {
        email: `replacement-${runId}@example.invalid`,
        normalizedEmail: `replacement-${runId}@example.invalid`,
        username: reusableUsername.toLowerCase(),
        tokenDigest: digest("invitation-token", `replacement-${runId}`, secret),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    reusableInvitationIds.push(replacement.id);
  });

  it("keeps unknown-account and wrong-password responses indistinguishable", async () => {
    const ip = `2001:db8:${runId.slice(0, 4)}::10`;
    const unknown = await signIn(undefined, { identifier: `missing-${runId}`, password: "Wrong-password-0000", ip });
    const wrong = await signIn(undefined, { password: "Wrong-password-0000", ip });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  it("rate limits repeated password attempts in the database", async () => {
    const ip = `2001:db8:${runId.slice(0, 4)}::20`;
    const responses = [];
    for (let index = 0; index < 11; index += 1) {
      responses.push(await signIn(undefined, { identifier: `missing-${runId}`, password: "Wrong-password-0000", ip }));
    }
    expect(responses[0].status).toBe(401);
    expect(responses.some((response) => response.status === 429)).toBe(true);
    expect(responses.at(-1)?.status).toBe(429);
  });

  it("does not expose public sign-up", async () => {
    const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: `signup-${runId}@example.invalid`, password, name: "Not allowed" }),
    }));
    expect(response.status).toBe(404);
  });
});
