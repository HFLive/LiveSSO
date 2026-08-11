import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { deleteProfileObject, putProfileObject } from "@/lib/object-storage";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_DIMENSION = 8_192;
const PROFILE_RETENTION_MS = 400 * 24 * 60 * 60 * 1_000;

export class ProfileImageError extends Error {}
export class ProfileNameError extends Error {}

export function normalizeProfileName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new ProfileNameError("显示名必须为 1–80 个字符，且不能包含控制字符。");
  }
  return name;
}

async function normalizeProfileImage(source: Uint8Array) {
  if (source.byteLength === 0 || source.byteLength > MAX_SOURCE_BYTES) throw new ProfileImageError("头像文件必须小于 8 MiB。");
  const decoder = sharp(source, { limitInputPixels: MAX_SOURCE_DIMENSION ** 2, failOn: "warning" });
  const metadata = await decoder.metadata().catch(() => { throw new ProfileImageError("无法识别头像文件。"); });
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) throw new ProfileImageError("仅支持 JPEG、PNG 或 WebP。");
  if (!metadata.width || !metadata.height || metadata.width > MAX_SOURCE_DIMENSION || metadata.height > MAX_SOURCE_DIMENSION) {
    throw new ProfileImageError("头像像素尺寸无效或过大。");
  }
  const body = await decoder.rotate().resize(512, 512, { fit: "cover", position: "centre" }).webp({ quality: 88, effort: 5 }).toBuffer();
  return { body, checksum: createHash("sha256").update(body).digest("hex") };
}

export function profileImageUrl(origin: string, userId: string, version: number) {
  return `${origin}/api/profile/avatar/${userId}?v=${version}`;
}

export async function updateProfileName(
  database: PrismaClient,
  input: { userId: string; name: string },
) {
  const name = normalizeProfileName(input.name);
  const now = new Date();
  const changeId = randomUUID();

  return database.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "user" WHERE "id" = ${input.userId}::uuid FOR UPDATE`,
    );
    const current = await transaction.user.findUnique({
      where: { id: input.userId },
      select: { name: true, accountStatus: true },
    });
    if (!current || current.accountStatus !== "ACTIVE") {
      throw new ProfileNameError("当前账号不能修改显示名。");
    }
    if (current.name === name) return { name, changed: false };

    await transaction.user.update({
      where: { id: input.userId },
      data: { name },
    });
    const webhooks = await transaction.clientWebhook.findMany({
      where: {
        active: true,
        eventTypes: { has: "user.profile.changed" },
        client: { disabled: false, approvalStatus: "APPROVED" },
      },
      select: { id: true, clientId: true },
    });
    await Promise.all(
      webhooks.map((webhook) =>
        transaction.outboxEvent.create({
          data: {
            aggregateType: "user",
            aggregateId: input.userId,
            eventType: "user.profile.changed",
            idempotencyKey: `user-profile:${input.userId}:name:${changeId}:${webhook.id}`,
            payload: {
              webhookId: webhook.id,
              clientId: webhook.clientId,
              subject: input.userId,
              name,
              occurredAt: now.toISOString(),
            },
          },
        }),
      ),
    );
    await transaction.auditEvent.create({
      data: {
        eventType: "user.profile.changed",
        actorType: "USER",
        actorUserId: input.userId,
        subjectUserId: input.userId,
        outcome: "SUCCESS",
        metadata: { field: "name", deliveryCount: webhooks.length },
        expiresAt: new Date(now.getTime() + PROFILE_RETENTION_MS),
      },
    });
    return { name, changed: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function replaceProfileImage(database: PrismaClient, input: { userId: string; origin: string; source: Uint8Array }) {
  const normalized = await normalizeProfileImage(input.source);
  const objectKey = `avatars/${input.userId}/${randomUUID()}.webp`;
  const pending = await database.$transaction(async (transaction) => {
    await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "user" WHERE "id" = ${input.userId}::uuid FOR UPDATE`);
    const latest = await transaction.profileAsset.aggregate({ where: { userId: input.userId }, _max: { version: true } });
    return transaction.profileAsset.create({ data: {
      userId: input.userId,
      objectKey,
      version: (latest._max.version ?? 0) + 1,
      status: "PENDING",
      contentType: "image/webp",
      byteSize: normalized.body.byteLength,
      checksum: normalized.checksum,
      width: 512,
      height: 512,
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  try {
    await putProfileObject({ key: objectKey, body: normalized.body, contentType: "image/webp", checksum: normalized.checksum });
  } catch (error) {
    await database.profileAsset.update({ where: { id: pending.id }, data: { status: "DELETED", deletedAt: new Date() } }).catch(() => undefined);
    throw error;
  }

  try {
    return await database.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "user" WHERE "id" = ${input.userId}::uuid FOR UPDATE`);
      const newer = await transaction.profileAsset.findFirst({ where: { userId: input.userId, status: "ACTIVE", version: { gt: pending.version } } });
      if (newer) {
        await transaction.profileAsset.update({ where: { id: pending.id }, data: { status: "REPLACED", activatedAt: new Date() } });
        return newer;
      }
      const now = new Date();
      await transaction.profileAsset.updateMany({ where: { userId: input.userId, status: "ACTIVE" }, data: { status: "REPLACED" } });
      const active = await transaction.profileAsset.update({ where: { id: pending.id }, data: { status: "ACTIVE", activatedAt: now } });
      const image = profileImageUrl(input.origin, input.userId, active.version);
      await transaction.user.update({ where: { id: input.userId }, data: { image } });
      const webhooks = await transaction.clientWebhook.findMany({
        where: { active: true, eventTypes: { has: "user.profile.changed" }, client: { disabled: false, approvalStatus: "APPROVED" } },
        select: { id: true, clientId: true },
      });
      await Promise.all(webhooks.map((webhook) => transaction.outboxEvent.create({ data: {
        aggregateType: "user",
        aggregateId: input.userId,
        eventType: "user.profile.changed",
        idempotencyKey: `user-profile:${input.userId}:${active.version}:${webhook.id}`,
        payload: { webhookId: webhook.id, clientId: webhook.clientId, subject: input.userId, picture: image, version: active.version, occurredAt: now.toISOString() },
      } })));
      await transaction.auditEvent.create({ data: {
        eventType: "user.profile.changed",
        actorType: "USER",
        actorUserId: input.userId,
        subjectUserId: input.userId,
        outcome: "SUCCESS",
        metadata: { field: "picture", version: active.version, deliveryCount: webhooks.length },
        expiresAt: new Date(now.getTime() + PROFILE_RETENTION_MS),
      } });
      return active;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    await deleteProfileObject(objectKey).catch(() => undefined);
    await database.profileAsset.updateMany({ where: { id: pending.id, status: "PENDING" }, data: { status: "DELETED", deletedAt: new Date() } }).catch(() => undefined);
    throw error;
  }
}
