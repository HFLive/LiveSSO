import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getSecurityHashSecret, getServerEnv } from "@/lib/env";
import { isMailEnabled, sendTransactionalMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { digestSensitiveValue } from "@/lib/security/digest";

const inputSchema = z.object({
  email: z.email().max(254),
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const actor = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (actor?.platformRole !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (!isMailEnabled()) return NextResponse.json({ error: "MAIL_DISABLED" }, { status: 503 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  const username = parsed.data.username.trim();
  const normalizedUsername = username.toLowerCase();
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: email, mode: "insensitive" } },
        { username: { equals: normalizedUsername, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (existingUser) return NextResponse.json({ error: "INVITATION_UNAVAILABLE" }, { status: 409 });
  const rawToken = randomBytes(32).toString("base64url");

  try {
    const invitation = await prisma.invitation.create({
      data: {
        email,
        normalizedEmail: email,
        username,
        tokenDigest: digestSensitiveValue("invitation-token", rawToken, getSecurityHashSecret()),
        invitedById: actor.id,
        grantedRole: "USER",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
      },
    });
    const url = new URL("/accept-invitation", getServerEnv().BETTER_AUTH_URL);
    url.searchParams.set("token", `${invitation.id}.${rawToken}`);
    try {
      await sendTransactionalMail({
        to: email,
        subject: "邀请你加入 HFLive",
        text: `你受邀加入 HFLive。管理员为你指定的用户名是 ${username}。\n\n请在 7 天内打开以下链接设置显示名和密码：\n${url}\n\n此链接只能使用一次。`,
      });
    } catch (error) {
      await prisma.invitation.update({ where: { id: invitation.id }, data: { status: "REVOKED", revokedAt: new Date() } });
      throw error;
    }
    await prisma.auditEvent.create({
      data: {
        eventType: "invitation.created",
        actorType: "USER",
        actorUserId: actor.id,
        outcome: "SUCCESS",
        metadata: { invitationId: invitation.id },
        expiresAt: new Date(Date.now() + 400 * 24 * 60 * 60 * 1_000),
      },
    });
    return NextResponse.json({ status: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "INVITATION_UNAVAILABLE" }, { status: 409 });
  }
}
