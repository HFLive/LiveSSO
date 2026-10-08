import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getSecurityHashSecret, getServerEnv } from "@/lib/env";
import {
  INVITATION_DURATIONS,
  invitationExpiry,
  type InvitationDuration,
} from "@/lib/invitation-duration";
import { isMailEnabled, sendTransactionalMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { digestSensitiveValue } from "@/lib/security/digest";
import { expireStaleInvitations } from "@/lib/security/domain-store";
import { requirePlatformAdmin } from "@/lib/security/admin";
import { listInvitations } from "@/lib/security/invitation-management";

const optionalDetail = (max: number) => z.string().max(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)).transform((value) => value.trim().replace(/\s+/g, " ") || null).nullable().optional();

const inputSchema = z.object({
  email: z.email().max(254),
  username: z.string().trim().max(32).refine((value) => value === "" || /^[a-zA-Z0-9_]{3,32}$/.test(value)).transform((value) => value || null).nullable().optional(),
  identityLabel: optionalDetail(40),
  realName: optionalDetail(80),
  expiresIn: z.enum(["2h", "1d", "7d", "30d"]).default("7d"),
});

class InvitationAccountExistsError extends Error {}

class InvitationReservedError extends Error {}

export async function GET() {
  const authorization = await requirePlatformAdmin();
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  return NextResponse.json({ invitations: await listInvitations(prisma) });
}

export async function POST(request: Request) {
  const authorization = await requirePlatformAdmin();
  if ("error" in authorization) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "INVALID_ORIGIN" }, { status: 403 });
  const actor = authorization.actor;
  if (!isMailEnabled()) return NextResponse.json({ error: "MAIL_DISABLED" }, { status: 503 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  const username = parsed.data.username ?? null;
  const normalizedUsername = username?.toLowerCase();
  const duration: InvitationDuration = parsed.data.expiresIn;
  const now = new Date();
  const expiresAt = invitationExpiry(duration, now);
  const rawToken = randomBytes(32).toString("base64url");

  try {
    const invitation = await prisma.$transaction(async (transaction) => {
      const existingUser = await transaction.user.findFirst({
        where: { OR: [
          { email: { equals: email, mode: "insensitive" } },
          ...(normalizedUsername ? [{ username: { equals: normalizedUsername, mode: "insensitive" as const } }] : []),
        ] }, select: { id: true },
      });
      if (existingUser) throw new InvitationAccountExistsError();
      await expireStaleInvitations(transaction, now);
      const reserved = await transaction.invitation.findFirst({
        where: {
          status: "PENDING",
          OR: [
            { normalizedEmail: email },
            ...(normalizedUsername ? [{ username: { equals: normalizedUsername, mode: "insensitive" as const } }] : []),
          ],
        },
        select: { id: true },
      });
      if (reserved) throw new InvitationReservedError();

      const created = await transaction.invitation.create({
        data: {
          email,
          normalizedEmail: email,
          username,
          identityLabel: parsed.data.identityLabel ?? null,
          realName: parsed.data.realName ?? null,
          tokenDigest: digestSensitiveValue("invitation-token", rawToken, getSecurityHashSecret()),
          invitedById: actor.id,
          grantedRole: "USER",
          expiresAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          eventType: "invitation.created",
          actorType: "USER",
          actorUserId: actor.id,
          outcome: "SUCCESS",
          metadata: { invitationId: created.id, expiresIn: duration },
          expiresAt: new Date(now.getTime() + 400 * 24 * 60 * 60 * 1_000),
        },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const url = new URL("/accept-invitation", getServerEnv().BETTER_AUTH_URL);
    url.searchParams.set("token", `${invitation.id}.${rawToken}`);
    try {
      await sendTransactionalMail({
        to: email,
        subject: "邀请你创建 HFLive Auth 账号",
        text: `管理员邀请你创建 HFLive Auth 账号。${username ? `指定的用户名为 ${username}。` : "请自行选择登录用户名。"}\n\n请在 ${INVITATION_DURATIONS[duration].label}内打开以下链接设置${username ? "显示名和密码" : "用户名、显示名和密码"}：\n${url}\n\n此链接只能使用一次。`,
      });
    } catch (error) {
      await prisma.invitation.updateMany({ where: { id: invitation.id, status: "PENDING" }, data: { status: "REVOKED", revokedAt: new Date() } });
      console.error("Invitation mail delivery failed", {
        cause: error instanceof Error ? error.name : "unknown",
      });
      return NextResponse.json({ error: "MAIL_DELIVERY_FAILED" }, { status: 502 });
    }
    return NextResponse.json(
      { status: true, expiresIn: duration, expiresAt: invitation.expiresAt.toISOString() },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof InvitationAccountExistsError) return NextResponse.json({ error: "ACCOUNT_EXISTS" }, { status: 409 });
    if (
      error instanceof InvitationReservedError ||
      (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
    ) {
      return NextResponse.json({ error: "INVITATION_PENDING" }, { status: 409 });
    }
    console.error("Invitation creation failed", {
      cause: error instanceof Error ? error.name : "unknown",
      code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined,
    });
    return NextResponse.json({ error: "INVITATION_FAILED" }, { status: 500 });
  }
}
