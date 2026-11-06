import { randomBytes, randomInt } from "node:crypto";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { APIError } from "better-auth/api";
import * as z from "zod";
import { getSecurityHashSecret, getServerEnv } from "@/lib/env";
import { isMailEnabled, sendSecurityNotice, sendTransactionalMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { digestSensitiveValue } from "@/lib/security/digest";
import { consumeLoginChallenge, recordLoginChallengeFailure } from "@/lib/security/domain-store";
import { assessLoginRisk } from "@/lib/security/login-risk";

const TRUST_COOKIE = "hflive_trusted_device";
const CHALLENGE_COOKIE = "hflive_login_challenge";
const LOGIN_AUDIT_MS = 90 * 24 * 60 * 60 * 1_000;
const CHALLENGE_MS = 10 * 60 * 1_000;
export const TRUST_MS = 30 * 24 * 60 * 60 * 1_000;

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function requestContext(request?: Request) {
  const ip = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request?.headers.get("x-real-ip") || "unknown";
  const userAgent = request?.headers.get("user-agent") || "unknown";
  const secret = getSecurityHashSecret();
  return {
    ipDigest: digestSensitiveValue("ip-address", ip, secret),
    userAgentDigest: digestSensitiveValue("user-agent", userAgent, secret),
  };
}

async function audit(input: {
  eventType: string;
  outcome: "SUCCESS" | "FAILURE" | "DENIED";
  subjectUserId?: string;
  request?: Request;
  metadata?: Record<string, string | number | boolean>;
  severity?: "INFO" | "WARNING" | "CRITICAL";
}) {
  const context = requestContext(input.request);
  await prisma.auditEvent.create({
    data: {
      eventType: input.eventType,
      actorType: input.subjectUserId ? "USER" : "SYSTEM",
      subjectUserId: input.subjectUserId,
      outcome: input.outcome,
      severity: input.severity ?? "INFO",
      ...context,
      metadata: input.metadata,
      expiresAt: new Date(Date.now() + LOGIN_AUDIT_MS),
    },
  });
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: getServerEnv().BETTER_AUTH_URL.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

function safeCallbackURL(candidate?: string) {
  if (!candidate) return undefined;
  try {
    const base = new URL(getServerEnv().BETTER_AUTH_URL);
    const resolved = new URL(candidate, base);
    const allowedOrigins = new Set([base.origin, ...getServerEnv().TRUSTED_ORIGINS.split(",").map((origin) => origin.trim())]);
    return allowedOrigins.has(resolved.origin) ? resolved.href : undefined;
  } catch {
    return undefined;
  }
}

export function riskAuthPlugin(): BetterAuthPlugin {
  return {
    id: "hflive-risk-auth",
    endpoints: {
      hfliveSignIn: createAuthEndpoint(
        "/hflive/sign-in",
        {
          method: "POST",
          body: z.object({
            identifier: z.string().min(1).max(254),
            password: z.string().min(1).max(128),
            callbackURL: z.string().optional(),
          }),
        },
        async (ctx) => {
          const callbackURL = safeCallbackURL(ctx.body.callbackURL);
          const identifier = ctx.body.identifier.trim().toLowerCase();
          const user = await prisma.user.findFirst({
            where: identifier.includes("@") ? { email: identifier } : { username: identifier },
            include: { accounts: true },
          });
          const credential = user?.accounts.find((account) => account.providerId === "credential")?.password;
          const valid = credential
            ? await ctx.context.password.verify({ hash: credential, password: ctx.body.password })
            : (await ctx.context.password.hash(ctx.body.password), false);

          if (!user || !valid || user.accountStatus !== "ACTIVE") {
            await audit({
              eventType: "login.password",
              outcome: "FAILURE",
              subjectUserId: user?.id,
              request: ctx.request,
              severity: "WARNING",
              metadata: { reason: user?.accountStatus === "DISABLED" ? "account_disabled" : "invalid_credentials" },
            });
            throw APIError.from("UNAUTHORIZED", { code: "INVALID_CREDENTIALS", message: "Invalid credentials" });
          }

          const now = new Date();
          const requestDigests = requestContext(ctx.request);
          const recentFailures = await prisma.auditEvent.count({
            where: {
              eventType: "login.password",
              subjectUserId: user.id,
              outcome: "FAILURE",
              createdAt: { gt: new Date(now.getTime() - 15 * 60_000) },
            },
          });
          const recentSuccesses = await prisma.auditEvent.count({
            where: {
              eventType: "login.completed",
              subjectUserId: user.id,
              outcome: "SUCCESS",
              createdAt: { gt: new Date(now.getTime() - 10 * 60_000) },
            },
          });
          const trustedToken = ctx.getCookie(TRUST_COOKIE);
          const trusted = trustedToken
            ? await prisma.trustedDevice.findUnique({
                where: { tokenDigest: digestSensitiveValue("trusted-device-token", trustedToken, getSecurityHashSecret()) },
              })
            : null;
          const trustedValid = trusted?.userId === user.id && !trusted.revokedAt && trusted.expiresAt > now;
          const riskReasons = assessLoginRisk({
            trusted: trustedValid,
            recentFailures,
            recentSuccesses,
            ipChanged: Boolean(trusted?.lastIpDigest && trusted.lastIpDigest !== requestDigests.ipDigest),
            userAgentChanged: Boolean(trusted?.userAgentDigest && trusted.userAgentDigest !== requestDigests.userAgentDigest),
          });

          if (riskReasons.length > 0 && isMailEnabled()) {
            const binding = randomToken();
            const otp = String(randomInt(100000, 1000000));
            const challenge = await prisma.loginChallenge.create({
              data: {
                userId: user.id,
                bindingDigest: digestSensitiveValue("login-challenge-binding", binding, getSecurityHashSecret()),
                otpDigest: digestSensitiveValue("login-otp", otp, getSecurityHashSecret()),
                riskReasons,
                riskScore: riskReasons.length * 20,
                ...requestDigests,
                expiresAt: new Date(now.getTime() + CHALLENGE_MS),
              },
            });
            ctx.setCookie(CHALLENGE_COOKIE, binding, cookieOptions(CHALLENGE_MS / 1_000));
            await sendTransactionalMail({
              to: user.email,
              subject: "HFLive Auth 登录验证码",
              text: `你的登录验证码是 ${otp}，10 分钟内有效。请勿将验证码转发给任何人。`,
            });
            await audit({
              eventType: "login.challenge.created",
              outcome: "SUCCESS",
              subjectUserId: user.id,
              request: ctx.request,
              metadata: { challengeId: challenge.id, riskReasons: riskReasons.join(",") },
            });
            return ctx.json({ challengeRequired: true, methods: ["email_otp"], url: callbackURL });
          }

          if (trustedValid && trusted) {
            await prisma.trustedDevice.update({
              where: { id: trusted.id },
              data: { lastUsedAt: now, lastIpDigest: requestDigests.ipDigest },
            });
          }
          const session = await ctx.context.internalAdapter.createSession(user.id, false);
          if (!session) throw APIError.from("INTERNAL_SERVER_ERROR", { code: "SESSION_FAILED", message: "Session failed" });
          await setSessionCookie(ctx, { session, user });
          await audit({
            eventType: "login.completed",
            outcome: "SUCCESS",
            subjectUserId: user.id,
            request: ctx.request,
            metadata: { challenged: false, mailDegraded: riskReasons.length > 0 },
          });
          return ctx.json({ authenticated: true, url: callbackURL });
        },
      ),
      hfliveVerifyChallenge: createAuthEndpoint(
        "/hflive/challenge/verify",
        {
          method: "POST",
          body: z.object({ otp: z.string().regex(/^\d{6}$/), trustDevice: z.boolean().default(false) }),
        },
        async (ctx) => {
          const binding = ctx.getCookie(CHALLENGE_COOKIE);
          if (!binding) throw APIError.from("UNAUTHORIZED", { code: "INVALID_CHALLENGE", message: "Invalid challenge" });
          const bindingDigest = digestSensitiveValue("login-challenge-binding", binding, getSecurityHashSecret());
          const challenge = await prisma.loginChallenge.findUnique({ where: { bindingDigest }, include: { user: true } });
          if (!challenge) throw APIError.from("UNAUTHORIZED", { code: "INVALID_CHALLENGE", message: "Invalid challenge" });
          const consumed = await consumeLoginChallenge(prisma, {
            id: challenge.id,
            bindingDigest,
            otpDigest: digestSensitiveValue("login-otp", ctx.body.otp, getSecurityHashSecret()),
          });
          if (!consumed) {
            await recordLoginChallengeFailure(prisma, { id: challenge.id, bindingDigest });
            throw APIError.from("UNAUTHORIZED", { code: "INVALID_CHALLENGE", message: "Invalid challenge" });
          }

          const rememberedUntil = ctx.body.trustDevice ? new Date(Date.now() + TRUST_MS) : undefined;
          const session = await ctx.context.internalAdapter.createSession(
            challenge.userId,
            false,
            rememberedUntil ? { expiresAt: rememberedUntil } : undefined,
            true,
          );
          if (!session) throw APIError.from("INTERNAL_SERVER_ERROR", { code: "SESSION_FAILED", message: "Session failed" });
          if (rememberedUntil) {
            const raw = randomToken();
            const requestDigests = requestContext(ctx.request);
            await prisma.trustedDevice.create({
              data: {
                userId: challenge.userId,
                tokenDigest: digestSensitiveValue("trusted-device-token", raw, getSecurityHashSecret()),
                userAgentDigest: requestDigests.userAgentDigest,
                firstIpDigest: requestDigests.ipDigest,
                lastIpDigest: requestDigests.ipDigest,
                expiresAt: rememberedUntil,
              },
            });
            ctx.setCookie(TRUST_COOKIE, raw, cookieOptions(TRUST_MS / 1_000));
          }
          await audit({
            eventType: "login.completed",
            outcome: "SUCCESS",
            subjectUserId: challenge.userId,
            request: ctx.request,
            metadata: { challenged: true, trustedDevice: ctx.body.trustDevice },
          });
          await setSessionCookie(ctx, { session, user: challenge.user }, false, rememberedUntil
            ? { maxAge: TRUST_MS / 1_000 }
            : undefined);
          ctx.setCookie(CHALLENGE_COOKIE, "", cookieOptions(0));
          await sendSecurityNotice(challenge.user.email, "检测到新设备或风险环境登录，邮箱验证码验证已通过。" ).catch(() => undefined);
          return ctx.json({ authenticated: true });
        },
      ),
    },
    rateLimit: [
      { pathMatcher: (path) => path === "/hflive/sign-in", window: 5 * 60, max: 10 },
      { pathMatcher: (path) => path === "/hflive/challenge/verify", window: 10 * 60, max: 8 },
    ],
  };
}
