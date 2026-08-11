import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteProfileObject, getProfileObject } from "@/lib/object-storage";
import { createApprovedClient } from "@/lib/security/client-service";
import {
  ProfileImageError,
  replaceProfileImage,
  updateProfileName,
} from "@/lib/security/profile-service";

const run = process.env.RUN_PHASE5_TESTS === "true";
const suite = run ? describe : describe.skip;

suite("Phase 5 profile avatar integration", () => {
  const suffix = randomUUID().slice(0, 10);
  let database: (typeof import("@/lib/prisma"))["prisma"];
  let userId = "";
  const objectKeys: string[] = [];
  let clientId = "";

  beforeAll(async () => {
    ({ prisma: database } = await import("@/lib/prisma"));
    const user = await database.user.create({ data: {
      email: `phase5-${suffix}@example.test`,
      name: "Phase 5 Test",
      username: `p5_${suffix.replaceAll("-", "_")}`,
      platformRole: "ADMIN",
    } });
    userId = user.id;
    const client = await createApprovedClient(database, {
      actorUserId: userId,
      name: "Phase 5 receiver",
      redirectUris: [],
      scopes: ["directory:user:read"],
      webhookUrl: "http://127.0.0.1:39999/events",
    });
    clientId = client.clientId;
  });

  afterAll(async () => {
    for (const key of objectKeys) await deleteProfileObject(key).catch(() => undefined);
    if (userId) {
      await database.outboxEvent.deleteMany({ where: { aggregateId: userId } });
    }
    if (clientId) await database.oauthClient.deleteMany({ where: { clientId } });
    if (userId) await database.user.deleteMany({ where: { id: userId } });
    await database.$disconnect();
  });

  it("normalizes, versions and persists avatars with a profile event", async () => {
    const firstSource = await sharp({ create: { width: 900, height: 600, channels: 4, background: "#9df5ad" } }).png().toBuffer();
    const first = await replaceProfileImage(database, { userId, origin: "https://auth.hsfz.live", source: firstSource });
    objectKeys.push(first.objectKey);
    expect(first).toMatchObject({ version: 1, status: "ACTIVE", contentType: "image/webp", width: 512, height: 512 });
    const stored = await getProfileObject(first.objectKey);
    const bytes = await stored.Body?.transformToByteArray();
    expect((await sharp(bytes).metadata())).toMatchObject({ format: "webp", width: 512, height: 512 });

    const secondSource = await sharp({ create: { width: 640, height: 960, channels: 3, background: "#101410" } }).jpeg().toBuffer();
    const second = await replaceProfileImage(database, { userId, origin: "https://auth.hsfz.live", source: secondSource });
    objectKeys.push(second.objectKey);
    expect(second.version).toBe(2);
    expect(await database.profileAsset.findUnique({ where: { id: first.id }, select: { status: true } })).toEqual({ status: "REPLACED" });
    expect(await database.user.findUnique({ where: { id: userId }, select: { image: true } })).toEqual({ image: `https://auth.hsfz.live/api/profile/avatar/${userId}?v=2` });
    const profileEvents = await database.outboxEvent.findMany({ where: { aggregateId: userId, eventType: "user.profile.changed" }, select: { payload: true } });
    expect(profileEvents.filter((event) => (event.payload as { clientId?: string }).clientId === clientId)).toHaveLength(2);
  });

  it("rejects undecodable input before creating metadata", async () => {
    await expect(replaceProfileImage(database, { userId, origin: "https://auth.hsfz.live", source: new Uint8Array([1, 2, 3]) })).rejects.toBeInstanceOf(ProfileImageError);
  });

  it("updates the display name and emits a profile event", async () => {
    await expect(
      updateProfileName(database, { userId, name: "  新显示名  " }),
    ).resolves.toEqual({ name: "新显示名", changed: true });
    expect(
      await database.user.findUnique({
        where: { id: userId },
        select: { name: true },
      }),
    ).toEqual({ name: "新显示名" });
    const event = await database.outboxEvent.findFirstOrThrow({
      where: {
        aggregateId: userId,
        eventType: "user.profile.changed",
        idempotencyKey: { contains: ":name:" },
      },
      select: { payload: true },
    });
    expect(event.payload).toMatchObject({
      clientId,
      subject: userId,
      name: "新显示名",
    });
  });
});
