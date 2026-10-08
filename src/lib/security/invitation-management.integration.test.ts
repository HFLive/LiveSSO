import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { consumeInvitation } from "./domain-store";
import { InvitationManagementError, listInvitations, revokeInvitation } from "./invitation-management";

const mocks = vi.hoisted(() => ({ actorId: "", sendMail: vi.fn() }));
vi.mock("./admin", () => ({ requirePlatformAdmin: async () => ({ actor: { id: mocks.actorId } }) }));
vi.mock("../mail", () => ({ isMailEnabled: () => true, sendTransactionalMail: mocks.sendMail, sendSecurityNotice: async () => undefined }));

const suite = process.env.RUN_INVITATION_TESTS === "true" ? describe : describe.skip;
suite("invitation management with PostgreSQL", () => {
  let db: (typeof import("../prisma"))["prisma"];
  let adminId: string, memberId: string;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `invite-${suffix}@example.invalid`;
  const username = `invite_${suffix}`;
  const invitationIds: string[] = [];
  const createdUserIds: string[] = [];
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
    mocks.actorId = adminId;
    memberId = (await db.user.create({ data: { name: "Invitation QA member", email: `invite-member-${suffix}@example.invalid` } })).id;
  });
  afterAll(async () => {
    if (!db) return;
    await db.invitation.deleteMany({ where: { id: { in: invitationIds } } });
    await db.user.deleteMany({ where: { id: { in: [adminId, memberId, ...createdUserIds] } } });
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
  it("creates invitations without usernames and applies only admin-owned identity details", async () => {
    const { POST: create } = await import("../../app/api/invitations/route");
    const { POST: accept } = await import("../../app/api/invitations/accept/route");
    for (const [index, usernameInput] of [undefined, "", "   ", null].entries()) {
      const targetEmail = `optional-${index}-${suffix}@example.invalid`;
      mocks.sendMail.mockClear();
      const response = await create(new Request("http://localhost:3000/api/invitations", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: targetEmail, username: usernameInput, ...(index === 0 ? { identityLabel: " 教师 ", realName: " 示例姓名 " } : {}) }),
      }));
      expect(response.status).toBe(201);
      const invitation = await db.invitation.findFirstOrThrow({ where: { normalizedEmail: targetEmail } });
      invitationIds.push(invitation.id);
      expect(invitation.username).toBeNull();
      const listed = (await listInvitations(db)).find((item) => item.id === invitation.id);
      expect(listed?.identityLabel).toBe(index === 0 ? "教师" : null);
      const mail = mocks.sendMail.mock.calls[0][0] as { text: string };
      const token = new URL(mail.text.match(/http:\/\/[^\s]+/)![0]).searchParams.get("token");
      expect((await accept(new Request("http://localhost:3000/api/invitations/accept", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name: "受邀成员", password: "Disposable-invitation-test-password", identityLabel: "伪造", realName: "伪造" }),
      }))).status).toBe(400);
      const request = () => new Request("http://localhost:3000/api/invitations/accept", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, username: `Selected_${index}_${suffix}`, name: "受邀成员", password: "Disposable-invitation-test-password", identityLabel: "伪造", realName: "伪造" }),
      });
      const outcomes = await Promise.all([accept(request()), accept(request())]);
      expect(outcomes.map((item) => item.status).sort()).toEqual([200, 400]);
      const user = await db.user.findUniqueOrThrow({ where: { email: targetEmail } });
      createdUserIds.push(user.id);
      expect(user.username).toBe(`selected_${index}_${suffix}`);
      expect(user.identityLabel).toBe(index === 0 ? "教师" : null);
      expect(user.realName).toBe(index === 0 ? "示例姓名" : null);
      expect(user.platformRole).toBe("USER");
    }
  });

  it("rejects invalid optional fields and prevents claiming another invitation's reserved username", async () => {
    const { POST: create } = await import("../../app/api/invitations/route");
    for (const extra of [{ username: "ab" }, { username: "bad-name" }, { identityLabel: "x".repeat(41) }, { realName: "x".repeat(81) }, { identityLabel: "bad\nlabel" }]) {
      expect((await create(new Request("http://localhost:3000/api/invitations", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email: `invalid-${suffix}@example.invalid`, ...extra }),
      }))).status).toBe(400);
    }
    const reserved = await createInvitation();
    const { digestSensitiveValue } = await import("./digest");
    const { getSecurityHashSecret } = await import("../env");
    const raw = randomUUID();
    const unassigned = await db.invitation.create({ data: {
      email: `unassigned-${suffix}@example.invalid`, normalizedEmail: `unassigned-${suffix}@example.invalid`,
      tokenDigest: digestSensitiveValue("invitation-token", raw, getSecurityHashSecret()), expiresAt: new Date(Date.now() + 60_000),
    } });
    invitationIds.push(unassigned.id);
    const { POST: accept } = await import("../../app/api/invitations/accept/route");
    expect((await accept(new Request("http://localhost:3000/api/invitations/accept", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: `${unassigned.id}.${raw}`, username: reserved.username!.toUpperCase(), name: "受邀成员", password: "Disposable-invitation-test-password" }),
    }))).status).toBe(400);
    expect(await db.user.count({ where: { email: unassigned.email } })).toBe(0);
    expect((await db.invitation.findUniqueOrThrow({ where: { id: unassigned.id } })).status).toBe("PENDING");
  });

});
