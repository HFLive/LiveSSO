import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consumeInvitation } from "./domain-store";
import { InvitationManagementError, listInvitations, revokeInvitation } from "./invitation-management";

const suite = process.env.RUN_INVITATION_TESTS === "true" ? describe : describe.skip;
suite("invitation management with PostgreSQL", () => {
  let db: (typeof import("../prisma"))["prisma"];
  let adminId: string, memberId: string;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `invite-${suffix}@example.invalid`;
  const username = `invite_${suffix}`;
  const invitationIds: string[] = [];
  async function createInvitation(tokenDigest = randomUUID()) {
    const invitation = await db.invitation.create({ data: {
      email, normalizedEmail: email, username,
      tokenDigest, invitedById: adminId, expiresAt: new Date(Date.now() + 60_000),
    } });
    invitationIds.push(invitation.id);
    return invitation;
  }
  beforeAll(async () => {
    await import("dotenv/config");
    ({ prisma: db } = await import("../prisma"));
    adminId = (await db.user.create({ data: { name: "Invitation QA admin", email: `invite-admin-${suffix}@example.invalid`, platformRole: "ADMIN" } })).id;
    memberId = (await db.user.create({ data: { name: "Invitation QA member", email: `invite-member-${suffix}@example.invalid` } })).id;
  });
  afterAll(async () => {
    if (!db) return;
    await db.invitation.deleteMany({ where: { id: { in: invitationIds } } });
    await db.user.deleteMany({ where: { id: { in: [adminId, memberId] } } });
    await db.$disconnect();
  });
  it("releases the email and username immediately and invalidates the old token", async () => {
    const tokenDigest = randomUUID();
    const first = await createInvitation(tokenDigest);
    const listed = (await listInvitations(db)).find((item) => item.id === first.id);
    expect(listed?.status).toBe("PENDING");
    expect(listed).not.toHaveProperty("tokenDigest");
    await expect(revokeInvitation(db, { actorUserId: memberId, invitationId: first.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await revokeInvitation(db, { actorUserId: adminId, invitationId: first.id })).status).toBe("REVOKED");
    const revoked = await db.invitation.findUniqueOrThrow({ where: { id: first.id } });
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect(await db.$transaction((tx) => consumeInvitation(tx, { id: first.id, tokenDigest, acceptedById: memberId }))).toBe(false);
    const replacement = await createInvitation();
    expect(replacement.username).toBe(username);
    expect(replacement.normalizedEmail).toBe(email);
    expect(await db.auditEvent.count({ where: { eventType: "invitation.revoked", actorUserId: adminId } })).toBe(1);
  });
  it("lets only one concurrent revoke succeed and preserves terminal state", async () => {
    const current = invitationIds.at(-1)!;
    const outcomes = await Promise.allSettled([
      revokeInvitation(db, { actorUserId: adminId, invitationId: current }),
      revokeInvitation(db, { actorUserId: adminId, invitationId: current }),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    await expect(revokeInvitation(db, { actorUserId: adminId, invitationId: current })).rejects.toBeInstanceOf(InvitationManagementError);
    expect((await db.invitation.findUniqueOrThrow({ where: { id: current } })).status).toBe("REVOKED");
    expect(await db.auditEvent.count({ where: { eventType: "invitation.revoked", actorUserId: adminId } })).toBe(2);
  });
});
