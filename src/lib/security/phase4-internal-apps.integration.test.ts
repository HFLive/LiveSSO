import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const suite = process.env.RUN_PHASE4_TESTS === "true" ? describe : describe.skip;

suite("Phase 4 internal applications", () => {
  let auth: (typeof import("../auth"))["auth"];
  let database: (typeof import("../prisma"))["prisma"];
  let createApprovedClient: typeof import("./client-service").createApprovedClient;
  let getApprovedClientDisplayName: typeof import("./client-service").getApprovedClientDisplayName;
  let setUserAccountStatus: typeof import("./client-service").setUserAccountStatus;
  let dispatchOutboxBatch: typeof import("./outbox-dispatch").dispatchOutboxBatch;
  const runId = randomUUID();
  let adminId: string; let userId: string;
  const createdClientIds: string[] = [];

  beforeAll(async () => {
    await import("dotenv/config");
    ({ auth } = await import("../auth")); ({ prisma: database } = await import("../prisma"));
    ({ createApprovedClient, getApprovedClientDisplayName, setUserAccountStatus } = await import("./client-service"));
    ({ dispatchOutboxBatch } = await import("./outbox-dispatch"));
    const [admin, user] = await Promise.all([
      database.user.create({ data: { name: "Phase 4 admin", email: `p4-admin-${runId}@example.invalid`, platformRole: "ADMIN", emailVerified: true } }),
      database.user.create({ data: { name: "Phase 4 user", email: `p4-user-${runId}@example.invalid`, emailVerified: true } }),
    ]);
    adminId = admin.id; userId = user.id;
  });

  afterAll(async () => {
    if (!database) return;
    await database.outboxEvent.deleteMany({ where: { aggregateId: userId } });
    await database.oauthClient.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await database.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
    await database.$disconnect();
  });

  function token(clientId: string, clientSecret: string, scope: string, resource?: string) {
    return auth.handler(new Request("http://localhost:3000/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
      body: new URLSearchParams({ grant_type: "client_credentials", scope, ...(resource ? { resource } : {}) }),
    }));
  }

  it("stores the OAuth secret only as a hash and rejects an over-scoped token request", async () => {
    const client = await createApprovedClient(database, { actorUserId: adminId, name: "Directory status only", redirectUris: [], scopes: ["directory:user:status"] });
    createdClientIds.push(client.clientId);
    const stored = await database.oauthClient.findUniqueOrThrow({ where: { clientId: client.clientId } });
    expect(stored.clientSecret).not.toBe(client.clientSecret);
    expect(stored.clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const response = await token(client.clientId, client.clientSecret, "directory:user:read");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_scope" });
  });

  it("resolves the approved client name shown on the consent page", async () => {
    const client = await createApprovedClient(database, { actorUserId: adminId, name: "LiveBoard Production", redirectUris: ["https://board.hsfz.live/api/auth/hflive/callback"], scopes: ["openid", "profile", "email"] });
    createdClientIds.push(client.clientId);

    await expect(getApprovedClientDisplayName(database, client.clientId)).resolves.toBe("LiveBoard Production");
    await database.oauthClient.update({ where: { clientId: client.clientId }, data: { disabled: true } });
    await expect(getApprovedClientDisplayName(database, client.clientId)).resolves.toBeUndefined();
  });

  it("rejects unapproved clients and a non-whitelisted redirect URI", async () => {
    const pendingId = `pending_${runId}`;
    createdClientIds.push(pendingId);
    await database.oauthClient.create({ data: { clientId: pendingId, clientSecret: "not-a-real-secret", disabled: true, approvalStatus: "PENDING", scopes: ["directory:user:status"], contacts: [], redirectUris: [], postLogoutRedirectUris: [], grantTypes: ["client_credentials"], responseTypes: [], createdAt: new Date(), updatedAt: new Date() } });
    expect((await token(pendingId, "not-a-real-secret", "directory:user:status")).status).toBe(400);

    const login = await createApprovedClient(database, { actorUserId: adminId, name: "Login app", redirectUris: ["https://app.example/callback"], scopes: ["openid", "profile"] });
    createdClientIds.push(login.clientId);
    const query = new URLSearchParams({ client_id: login.clientId, redirect_uri: "https://evil.example/callback", response_type: "code", scope: "openid", code_challenge: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~", code_challenge_method: "S256" });
    const { GET } = await import("../../app/api/auth/[...all]/route");
    const response = await GET(new Request(`http://localhost:3000/api/auth/oauth2/authorize?${query}`));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get("location") ?? "").not.toContain("evil.example");
  });

  it("issues a least-privilege M2M token accepted by the Directory status API", async () => {
    const client = await createApprovedClient(database, { actorUserId: adminId, name: "Directory reader", redirectUris: [], scopes: ["directory:user:status"] });
    createdClientIds.push(client.clientId);
    const wrongAudience = await token(client.clientId, client.clientSecret, "directory:user:status", "https://other-resource.example");
    expect(wrongAudience.status).toBe(400);
    expect(await wrongAudience.json()).toMatchObject({ error: "invalid_request" });

    const response = await token(client.clientId, client.clientSecret, "directory:user:status");
    expect(response.status).toBe(200);
    const body = await response.json() as { access_token: string };
    expect(body.access_token).not.toContain(".");
    const { GET } = await import("../../app/api/directory/users/[userId]/status/route");
    const directory = await GET(new Request(`http://localhost:3000/api/directory/users/${userId}/status`, { headers: { authorization: `Bearer ${body.access_token}` } }), { params: Promise.resolve({ userId }) });
    expect(directory.status).toBe(200);
    expect(await directory.json()).toMatchObject({ subject: userId, status: "ACTIVE" });
  });

  it("creates one signed outbox delivery and completes it exactly once", async () => {
    const client = await createApprovedClient(database, { actorUserId: adminId, name: "Event receiver", redirectUris: [], scopes: ["directory:user:status"], webhookUrl: "https://events.example/hflive" });
    createdClientIds.push(client.clientId);
    await setUserAccountStatus(database, { actorUserId: adminId, subjectUserId: userId, status: "DISABLED" });
    const calls: Array<{ headers: Headers; body: string }> = [];
    const result = await dispatchOutboxBatch({ limit: 10, fetchImpl: async (_url, init) => {
      calls.push({ headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response(null, { status: 204 });
    } });
    expect(result.delivered).toBe(1); expect(calls).toHaveLength(1);
    expect(calls[0].headers.get("x-hflive-signature")).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(JSON.parse(calls[0].body)).toMatchObject({ type: "user.status.changed", subject: userId, status: "DISABLED" });
    expect((await dispatchOutboxBatch({ limit: 10, fetchImpl: async () => new Response(null, { status: 204 }) })).claimed).toBe(0);
  });
});
