import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptWebhookSecret } from "./webhook-secret";

const suite = process.env.RUN_PHASE4_TESTS === "true" ? describe : describe.skip;

suite("Client webhook management", () => {
  let database: (typeof import("../prisma"))["prisma"];
  let createApprovedClient: typeof import("./client-service").createApprovedClient;
  let updateClientWebhook: typeof import("./client-service").updateClientWebhook;
  let rotateWebhookSecret: typeof import("./client-service").rotateWebhookSecret;
  let getClientWebhookStatus: typeof import("./client-service").getClientWebhookStatus;
  const runId = randomUUID();
  let adminId: string;
  const createdClientIds: string[] = [];

  beforeAll(async () => {
    await import("dotenv/config");
    ({ prisma: database } = await import("../prisma"));
    ({ createApprovedClient, updateClientWebhook, rotateWebhookSecret, getClientWebhookStatus } = await import("./client-service"));
    const admin = await database.user.create({ data: { name: "Webhook admin", email: `wh-admin-${runId}@example.invalid`, platformRole: "ADMIN", emailVerified: true } });
    adminId = admin.id;
  });

  afterAll(async () => {
    if (!database) return;
    await database.outboxEvent.deleteMany({ where: { idempotencyKey: { startsWith: "wh-status-" } } });
    await database.oauthClient.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await database.user.deleteMany({ where: { id: adminId } });
    await database.$disconnect();
  });

  async function makeClient(webhookUrl?: string) {
    const client = await createApprovedClient(database, { actorUserId: adminId, name: `Webhook client ${runId}`, redirectUris: [], scopes: ["directory:user:read"], webhookUrl });
    createdClientIds.push(client.clientId);
    return client;
  }

  it("creates a webhook row on demand and returns the plaintext secret exactly once", async () => {
    const client = await makeClient();
    const result = await updateClientWebhook(database, { actorUserId: adminId, clientId: client.clientId, endpointUrl: "https://events.example/hflive" });
    expect(result).not.toBeNull();
    expect(result!.webhookSecret).toBeTruthy();
    const row = await database.clientWebhook.findUniqueOrThrow({ where: { clientId: client.clientId } });
    expect(row.endpointUrl).toBe("https://events.example/hflive");
    expect(row.eventTypes).toEqual(["user.status.changed", "user.profile.changed"]);
    expect(decryptWebhookSecret(row.signingSecretCiphertext)).toBe(result!.webhookSecret);
    // 再次保存同一 URL 不应再返回新密钥（非创建路径）
    const again = await updateClientWebhook(database, { actorUserId: adminId, clientId: client.clientId, endpointUrl: "https://events.example/hflive" });
    expect(again!.webhookSecret).toBeUndefined();
  });

  it("updates endpointUrl and eventTypes on an existing webhook", async () => {
    const client = await makeClient("https://old.example/events");
    const result = await updateClientWebhook(database, { actorUserId: adminId, clientId: client.clientId, endpointUrl: "https://new.example/events", eventTypes: ["user.status.changed"] });
    expect(result).not.toBeNull();
    const row = await database.clientWebhook.findUniqueOrThrow({ where: { clientId: client.clientId } });
    expect(row.endpointUrl).toBe("https://new.example/events");
    expect(row.eventTypes).toEqual(["user.status.changed"]);
  });

  it("rejects webhook URLs with credentials and unsupported event types", async () => {
    const client = await makeClient("https://ok.example/events");
    await expect(updateClientWebhook(database, { actorUserId: adminId, clientId: client.clientId, endpointUrl: "https://user:pass@example.com/events" })).rejects.toThrow(/credentials/);
    await expect(updateClientWebhook(database, { actorUserId: adminId, clientId: client.clientId, eventTypes: ["user.created"] })).rejects.toThrow(/Unsupported event type/);
    const row = await database.clientWebhook.findUniqueOrThrow({ where: { clientId: client.clientId } });
    expect(row.endpointUrl).toBe("https://ok.example/events");
  });

  it("rotates the webhook secret and returns it only in the response", async () => {
    const client = await makeClient("https://events.example/hflive");
    const before = await database.clientWebhook.findUniqueOrThrow({ where: { clientId: client.clientId } });
    const secret = await rotateWebhookSecret(database, adminId, client.clientId);
    expect(secret).toBeTruthy();
    const after = await database.clientWebhook.findUniqueOrThrow({ where: { clientId: client.clientId } });
    expect(after.signingSecretCiphertext).not.toBe(before.signingSecretCiphertext);
    expect(decryptWebhookSecret(after.signingSecretCiphertext)).toBe(secret);
    const audit = await database.auditEvent.count({ where: { clientId: client.clientId, eventType: "oauth.client.webhook.secret.rotated" } });
    expect(audit).toBeGreaterThan(0);
  });

  it("aggregates outbox delivery status per client webhook", async () => {
    const client = await makeClient("https://events.example/hflive");
    const webhook = await database.clientWebhook.findUniqueOrThrow({ where: { clientId: client.clientId } });
    await Promise.all([
      database.outboxEvent.create({ data: { aggregateType: "user", aggregateId: adminId, eventType: "user.status.changed", idempotencyKey: `wh-status-pending-${runId}`, payload: { webhookId: webhook.id, clientId: client.clientId }, status: "PENDING" } }),
      database.outboxEvent.create({ data: { aggregateType: "user", aggregateId: adminId, eventType: "user.status.changed", idempotencyKey: `wh-status-dead-${runId}`, payload: { webhookId: webhook.id, clientId: client.clientId }, status: "DEAD_LETTER", attemptCount: 10, lastErrorCode: "HTTP_503", deliveredAt: null } }),
    ]);
    const status = await getClientWebhookStatus(database, client.clientId);
    expect(status).not.toBeNull();
    expect(status!.counts.pending).toBe(1);
    expect(status!.counts.deadLetter).toBe(1);
    expect(status!.recentFailures[0]?.lastErrorCode).toBe("HTTP_503");
  });
});
