import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { markOutboxPending } from "@/lib/security/outbox-pending";
import { encryptWebhookSecret } from "@/lib/security/webhook-secret";

export const DIRECTORY_SCOPES = ["directory:user:read", "directory:user:status"] as const;
export const LOGIN_SCOPES = ["openid", "profile", "email", "offline_access"] as const;
export const CLIENT_SCOPES = [...LOGIN_SCOPES, ...DIRECTORY_SCOPES] as const;
export const EVENT_TYPES = ["user.status.changed", "user.profile.changed"] as const;
const RETENTION_MS = 400 * 24 * 60 * 60 * 1_000;

export async function getApprovedClientDisplayName(database: PrismaClient, clientId: string | undefined) {
  if (!clientId) return undefined;

  const client = await database.oauthClient.findFirst({
    where: { clientId, approvalStatus: "APPROVED", disabled: false },
    select: { name: true },
  });

  return client?.name;
}

function hashOAuthSecret(secret: string) {
  return createHash("sha256").update(secret).digest("base64url");
}

export function assertWebhookUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.hash) throw new Error("Webhook URL cannot contain credentials or fragments.");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("Production webhooks require HTTPS.");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Webhook URL must use HTTP(S).");
  return url.toString();
}

function assertEventTypes(values: string[]) {
  if (values.length === 0) throw new Error("eventTypes cannot be empty.");
  if (values.some((value) => !EVENT_TYPES.includes(value as (typeof EVENT_TYPES)[number]))) {
    throw new Error(`Unsupported event type. Allowed: ${EVENT_TYPES.join(", ")}.`);
  }
  return [...values];
}

export async function updateClientWebhook(database: PrismaClient, input: { actorUserId: string; clientId: string; endpointUrl?: string; eventTypes?: string[] }) {
  const endpointUrl = input.endpointUrl !== undefined ? assertWebhookUrl(input.endpointUrl) : undefined;
  const eventTypes = input.eventTypes !== undefined ? assertEventTypes(input.eventTypes) : undefined;
  const now = new Date();
  let createdSecret: string | undefined;
  const updated = await database.$transaction(async (transaction) => {
    const client = await transaction.oauthClient.findUnique({ where: { clientId: input.clientId, approvalStatus: "APPROVED" }, select: { clientId: true } });
    if (!client) return false;
    const existing = await transaction.clientWebhook.findUnique({ where: { clientId: input.clientId }, select: { clientId: true } });
    if (existing) {
      await transaction.clientWebhook.update({
        where: { clientId: input.clientId },
        data: { ...(endpointUrl !== undefined ? { endpointUrl } : {}), ...(eventTypes !== undefined ? { eventTypes } : {}), active: true, updatedAt: now },
      });
    } else {
      if (!endpointUrl) throw new Error("A webhook URL is required when the client has no webhook yet.");
      createdSecret = randomBytes(32).toString("base64url");
      await transaction.clientWebhook.create({
        data: { clientId: input.clientId, endpointUrl, signingSecretCiphertext: encryptWebhookSecret(createdSecret), eventTypes: eventTypes ?? [...EVENT_TYPES], active: true },
      });
    }
    await transaction.auditEvent.create({
      data: { eventType: "oauth.client.webhook.updated", actorType: "USER", actorUserId: input.actorUserId, clientId: input.clientId, outcome: "SUCCESS", severity: "CRITICAL", metadata: { endpointUrl, eventTypes }, expiresAt: new Date(now.getTime() + RETENTION_MS) },
    });
    return true;
  });
  return updated ? { webhookSecret: createdSecret } : null;
}

export async function rotateWebhookSecret(database: PrismaClient, actorUserId: string, clientId: string) {
  const secret = randomBytes(32).toString("base64url");
  const now = new Date();
  const updated = await database.$transaction(async (transaction) => {
    const webhook = await transaction.clientWebhook.findUnique({ where: { clientId }, select: { clientId: true } });
    if (!webhook) return false;
    await transaction.clientWebhook.update({ where: { clientId }, data: { signingSecretCiphertext: encryptWebhookSecret(secret), updatedAt: now } });
    await transaction.auditEvent.create({
      data: { eventType: "oauth.client.webhook.secret.rotated", actorType: "USER", actorUserId, clientId, outcome: "SUCCESS", severity: "CRITICAL", expiresAt: new Date(now.getTime() + RETENTION_MS) },
    });
    return true;
  });
  return updated ? secret : null;
}

export async function getClientWebhookStatus(database: PrismaClient, clientId: string) {
  const webhook = await database.clientWebhook.findUnique({
    where: { clientId },
    select: { id: true, active: true, endpointUrl: true, eventTypes: true, updatedAt: true },
  });
  if (!webhook) return null;
  const byWebhook = { payload: { path: ["webhookId"], equals: webhook.id } } satisfies Prisma.OutboxEventWhereInput;
  const [pending, processing, deadLetter, delivered, recentFailures] = await Promise.all([
    database.outboxEvent.count({ where: { ...byWebhook, status: "PENDING" } }),
    database.outboxEvent.count({ where: { ...byWebhook, status: "PROCESSING" } }),
    database.outboxEvent.count({ where: { ...byWebhook, status: "DEAD_LETTER" } }),
    database.outboxEvent.count({ where: { ...byWebhook, status: "DELIVERED" } }),
    database.outboxEvent.findMany({
      where: { ...byWebhook, status: "DEAD_LETTER" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, eventType: true, attemptCount: true, lastErrorCode: true, updatedAt: true },
    }),
  ]);
  return { webhook: { id: webhook.id, active: webhook.active, endpointUrl: webhook.endpointUrl, eventTypes: webhook.eventTypes, updatedAt: webhook.updatedAt }, counts: { pending, processing, deadLetter, delivered }, recentFailures };
}

export async function createApprovedClient(database: PrismaClient, input: {
  actorUserId: string;
  name: string;
  redirectUris: string[];
  scopes: string[];
  webhookUrl?: string;
}) {
  const now = new Date();
  const clientId = `hflive_${randomBytes(18).toString("base64url")}`;
  const clientSecret = randomBytes(32).toString("base64url");
  const webhookSecret = input.webhookUrl ? randomBytes(32).toString("base64url") : undefined;
  const hasLogin = input.scopes.some((scope) => LOGIN_SCOPES.includes(scope as (typeof LOGIN_SCOPES)[number]));
  const hasDirectory = input.scopes.some((scope) => DIRECTORY_SCOPES.includes(scope as (typeof DIRECTORY_SCOPES)[number]));

  await database.$transaction(async (transaction) => {
    await transaction.oauthClient.create({
      data: {
        clientId,
        clientSecret: hashOAuthSecret(clientSecret),
        name: input.name,
        disabled: false,
        approvalStatus: "APPROVED",
        approvedById: input.actorUserId,
        approvedAt: now,
        scopes: input.scopes,
        redirectUris: hasLogin ? input.redirectUris : [],
        postLogoutRedirectUris: [],
        contacts: [],
        grantTypes: [...(hasLogin ? ["authorization_code"] : []), ...(hasDirectory ? ["client_credentials"] : [])],
        responseTypes: hasLogin ? ["code"] : [],
        tokenEndpointAuthMethod: "client_secret_basic",
        public: false,
        type: "web",
        requirePKCE: hasLogin,
        enableEndSession: hasLogin,
        skipConsent: false,
        createdAt: now,
        updatedAt: now,
      },
    });
    if (input.webhookUrl && webhookSecret) {
      await transaction.clientWebhook.create({
        data: {
          clientId,
          endpointUrl: assertWebhookUrl(input.webhookUrl),
          signingSecretCiphertext: encryptWebhookSecret(webhookSecret),
          eventTypes: [...EVENT_TYPES],
        },
      });
    }
    await transaction.auditEvent.create({
      data: {
        eventType: "oauth.client.created",
        actorType: "USER",
        actorUserId: input.actorUserId,
        clientId,
        outcome: "SUCCESS",
        severity: "CRITICAL",
        metadata: { scopes: input.scopes, redirectUriCount: input.redirectUris.length, webhookEnabled: Boolean(input.webhookUrl) },
        expiresAt: new Date(now.getTime() + RETENTION_MS),
      },
    });
  });
  return { clientId, clientSecret, webhookSecret };
}

export async function rotateClientSecret(database: PrismaClient, actorUserId: string, clientId: string) {
  const secret = randomBytes(32).toString("base64url");
  const updated = await database.$transaction(async (transaction) => {
    const result = await transaction.oauthClient.updateMany({
      where: { clientId, public: false, approvalStatus: "APPROVED" },
      data: { clientSecret: hashOAuthSecret(secret), updatedAt: new Date() },
    });
    if (result.count !== 1) return false;
    await transaction.oauthAccessToken.deleteMany({ where: { clientId } });
    await transaction.oauthRefreshToken.deleteMany({ where: { clientId } });
    await transaction.auditEvent.create({
      data: { eventType: "oauth.client.secret.rotated", actorType: "USER", actorUserId, clientId, outcome: "SUCCESS", severity: "CRITICAL", expiresAt: new Date(Date.now() + RETENTION_MS) },
    });
    return true;
  });
  return updated ? secret : null;
}

export async function setClientDisabled(database: PrismaClient, actorUserId: string, clientId: string, disabled: boolean) {
  return database.$transaction(async (transaction) => {
    const result = await transaction.oauthClient.updateMany({ where: { clientId, approvalStatus: "APPROVED" }, data: { disabled, updatedAt: new Date() } });
    if (result.count !== 1) return false;
    if (disabled) {
      await transaction.oauthAccessToken.deleteMany({ where: { clientId } });
      await transaction.oauthRefreshToken.deleteMany({ where: { clientId } });
    }
    await transaction.auditEvent.create({
      data: { eventType: disabled ? "oauth.client.disabled" : "oauth.client.enabled", actorType: "USER", actorUserId, clientId, outcome: "SUCCESS", severity: "CRITICAL", expiresAt: new Date(Date.now() + RETENTION_MS) },
    });
    return true;
  });
}

export async function updateClientConfiguration(database: PrismaClient, input: { actorUserId: string; clientId: string; redirectUris: string[]; scopes: string[] }) {
  const hasLogin = input.scopes.some((scope) => LOGIN_SCOPES.includes(scope as (typeof LOGIN_SCOPES)[number]));
  const hasDirectory = input.scopes.some((scope) => DIRECTORY_SCOPES.includes(scope as (typeof DIRECTORY_SCOPES)[number]));
  if (hasLogin && input.redirectUris.length === 0) throw new Error("Login clients require a redirect URI.");
  return database.$transaction(async (transaction) => {
    const result = await transaction.oauthClient.updateMany({
      where: { clientId: input.clientId, approvalStatus: "APPROVED" },
      data: {
        redirectUris: hasLogin ? input.redirectUris : [],
        scopes: input.scopes,
        grantTypes: [...(hasLogin ? ["authorization_code"] : []), ...(hasDirectory ? ["client_credentials"] : [])],
        responseTypes: hasLogin ? ["code"] : [],
        requirePKCE: hasLogin,
        updatedAt: new Date(),
      },
    });
    if (result.count !== 1) return false;
    await transaction.oauthAccessToken.deleteMany({ where: { clientId: input.clientId } });
    await transaction.oauthRefreshToken.deleteMany({ where: { clientId: input.clientId } });
    await transaction.oauthConsent.deleteMany({ where: { clientId: input.clientId } });
    await transaction.auditEvent.create({ data: { eventType: "oauth.client.configuration.updated", actorType: "USER", actorUserId: input.actorUserId, clientId: input.clientId, outcome: "SUCCESS", severity: "CRITICAL", metadata: { scopes: input.scopes, redirectUriCount: input.redirectUris.length }, expiresAt: new Date(Date.now() + RETENTION_MS) } });
    return true;
  });
}

export async function setUserAccountStatus(database: PrismaClient, input: { actorUserId: string; subjectUserId: string; status: "ACTIVE" | "DISABLED" }) {
  const now = new Date();
  const result = await database.$transaction(async (transaction) => {
    const user = await transaction.user.update({ where: { id: input.subjectUserId }, data: { accountStatus: input.status } });
    if (input.status === "DISABLED") await transaction.session.deleteMany({ where: { userId: user.id } });
    const webhooks = await transaction.clientWebhook.findMany({
      where: { active: true, eventTypes: { has: "user.status.changed" }, client: { disabled: false, approvalStatus: "APPROVED" } },
      select: { id: true, clientId: true },
    });
    await Promise.all(webhooks.map((webhook) => transaction.outboxEvent.create({
      data: {
        aggregateType: "user",
        aggregateId: user.id,
        eventType: "user.status.changed",
        idempotencyKey: `user-status:${user.id}:${now.toISOString()}:${webhook.id}`,
        payload: { webhookId: webhook.id, clientId: webhook.clientId, subject: user.id, status: input.status, occurredAt: now.toISOString() },
      },
    })));
    await transaction.auditEvent.create({
      data: { eventType: "user.status.changed", actorType: "USER", actorUserId: input.actorUserId, subjectUserId: user.id, outcome: "SUCCESS", severity: "CRITICAL", metadata: { status: input.status, deliveryCount: webhooks.length }, expiresAt: new Date(now.getTime() + RETENTION_MS) },
    });
    return { user, deliveryCount: webhooks.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (result.deliveryCount > 0) await markOutboxPending();
  return result.user;
}
