import { Prisma } from "@/generated/prisma/client";
import { randomInt } from "node:crypto";
import { createAuthEndpoint } from "better-auth/api";
import { APIError, getAuthoritativeSessionFromCtx } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import * as z from "zod";
import { getSecurityHashSecret } from "@/lib/env";
import { sendSecurityNotice, sendTransactionalMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { digestSensitiveValue } from "@/lib/security/digest";
import {
  EmailChangeError,
  cancelEmailChange,
  confirmEmailChange,
  requestEmailChange,
} from "@/lib/security/email-change-service";

const EMAIL_CHANGE_AUDIT_MS = 400 * 24 * 60 * 60 * 1_000;

function requestContext(request?: Request) {
  const ip = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request?.headers.get("x-real-ip") || "unknown";
  const userAgent = request?.headers.get("user-agent") || "unknown";
  const secret = getSecurityHashSecret();
  return {
    ipDigest: digestSensitiveValue("ip-address", ip, secret),
    userAgentDigest: digestSensitiveValue("user-agent", userAgent, secret),
  };
}

async function auditFailure(input: {
  eventType: string;
  subjectUserId: string;
  request?: Request;
  metadata?: Record<string, string | number | boolean>;
}) {
  const context = requestContext(input.request);
  await prisma.auditEvent.create({
    data: {
      eventType: input.eventType,
      actorType: "USER",
      actorUserId: input.subjectUserId,
      subjectUserId: input.subjectUserId,
      outcome: "FAILURE",
      severity: "WARNING",
      ...context,
      metadata: input.metadata,
      expiresAt: new Date(Date.now() + EMAIL_CHANGE_AUDIT_MS),
    },
  }).catch(() => undefined);
}

function emailChangeApiError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
    throw APIError.from(409, { code: "RETRY_REQUIRED", message: "请求状态发生变化，请刷新页面后重试。" });
  }
  if (!(error instanceof EmailChangeError)) throw error;
  const statusByCode: Record<EmailChangeError["code"], 400 | 409 | 502> = {
    INVALID_EMAIL: 400,
    EMAIL_TAKEN: 409,
    EMAIL_RESERVED: 409,
    SAME_EMAIL: 400,
    NO_PENDING_REQUEST: 400,
    INVALID_OTP: 400,
    ACCOUNT_NOT_ACTIVE: 400,
    MAIL_DELIVERY_FAILED: 502,
  };
  throw APIError.from(statusByCode[error.code], { code: ["EMAIL_TAKEN", "EMAIL_RESERVED"].includes(error.code) ? "EMAIL_UNAVAILABLE" : error.code, message: error.message });
}

async function requireSession(ctx: Parameters<typeof getAuthoritativeSessionFromCtx>[0]) {
  const session = await getAuthoritativeSessionFromCtx(ctx);
  if (!session) {
    throw APIError.from("UNAUTHORIZED", { code: "UNAUTHORIZED", message: "需要登录后才能操作。" });
  }
  return session;
}

export function profileEmailPlugin(): BetterAuthPlugin {
  return {
    id: "hflive-profile-email",
    endpoints: {
      emailChangeRequest: createAuthEndpoint(
        "/hflive/profile/email/request",
        {
          method: "POST",
          body: z.object({
            newEmail: z.string().min(3).max(254),
            password: z.string().min(1).max(128),
          }),
        },
        async (ctx) => {
          const session = await requireSession(ctx);
          const userId = session.user.id;

          const account = await prisma.account.findFirst({
            where: { userId, providerId: "credential" },
            select: { password: true },
          });
          const credential = account?.password;
          const valid = credential
            ? await ctx.context.password.verify({ hash: credential, password: ctx.body.password })
            : (await ctx.context.password.hash(ctx.body.password), false);
          if (!valid) {
            await auditFailure({
              eventType: "user.email.change.requested",
              subjectUserId: userId,
              request: ctx.request,
              metadata: { reason: "invalid_password" },
            });
            throw APIError.from("UNAUTHORIZED", { code: "INVALID_PASSWORD", message: "当前密码不正确。" });
          }

          const otp = String(randomInt(100000, 1000000));
          const secret = getSecurityHashSecret();
          const digests = requestContext(ctx.request);

          let requested;
          try {
            requested = await requestEmailChange(prisma, {
              userId,
              newEmail: ctx.body.newEmail,
              otpDigest: digestSensitiveValue("email-change-otp", `${userId}:${otp}`, secret),
              ...digests,
            });
          } catch (error) {
            emailChangeApiError(error);
          }

          try {
            await sendTransactionalMail({
              to: requested.newEmail,
              subject: "确认更改 HFLive Auth 邮箱",
              text: `你正在把 HFLive Auth 账号的邮箱更改为这个邮箱。\n\n验证码是 ${otp}，10 分钟内有效。请勿把验证码转发给任何人。\n\n如果这不是你发起的操作，请忽略这封邮件，账号邮箱不会改变。`,
            });
          } catch (error) {
            await prisma.emailChangeRequest.updateMany({
              where: { id: requested.requestId, userId, status: "PENDING" },
              data: { status: "CANCELLED", cancelledAt: new Date() },
            });
            console.error("Email change OTP delivery failed", {
              cause: error instanceof Error ? error.name : "unknown",
            });
            throw emailChangeApiError(
              new EmailChangeError("MAIL_DELIVERY_FAILED", "验证码邮件发送失败，请稍后重试。"),
            );
          }

          return ctx.json({ requested: true, newEmail: requested.newEmail, expiresAt: requested.expiresAt.toISOString() });
        },
      ),
      emailChangeConfirm: createAuthEndpoint(
        "/hflive/profile/email/confirm",
        {
          method: "POST",
          body: z.object({ otp: z.string().regex(/^\d{6}$/) }),
        },
        async (ctx) => {
          const session = await requireSession(ctx);
          const userId = session.user.id;

          let result;
          try {
            result = await confirmEmailChange(prisma, {
              userId,
              otpDigest: digestSensitiveValue("email-change-otp", `${userId}:${ctx.body.otp}`, getSecurityHashSecret()),
            });
          } catch (error) {
            emailChangeApiError(error);
          }

          await sendSecurityNotice(
            result.oldEmail,
            `你的 HFLive Auth 账号邮箱已从 ${result.oldEmail} 更改为 ${result.newEmail}，之后请使用新邮箱登录。`,
          ).catch(() => undefined);

          return ctx.json({ email: result.newEmail, emailVerified: true });
        },
      ),
      emailChangeCancel: createAuthEndpoint(
        "/hflive/profile/email/cancel",
        { method: "POST" },
        async (ctx) => {
          const session = await requireSession(ctx);
          const result = await cancelEmailChange(prisma, { userId: session.user.id });
          return ctx.json({ cancelled: result.cancelled });
        },
      ),
    },
    rateLimit: [
      { pathMatcher: (path) => path === "/hflive/profile/email/request", window: 10 * 60, max: 5 },
      { pathMatcher: (path) => path === "/hflive/profile/email/confirm", window: 10 * 60, max: 15 },
      { pathMatcher: (path) => path === "/hflive/profile/email/cancel", window: 10 * 60, max: 15 },
    ],
  };
}
