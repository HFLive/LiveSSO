import { Prisma, type PrismaClient, type LoginChallenge } from "@/generated/prisma/client";

export const LOGIN_RESEND_COOLDOWN_MS = 60_000;
const MAX_RESENDS = 3;

export class LoginChallengeError extends Error {
  constructor(public code: "INVALID_CHALLENGE" | "CHALLENGE_EXPIRED" | "CHALLENGE_LOCKED" | "RESEND_LIMITED", public retryAt?: Date) {
    super(code);
  }
}

export function maskLoginEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function assertPending(challenge: (LoginChallenge & { user: { accountStatus: string } }) | null, now: Date) {
  if (!challenge || challenge.user.accountStatus !== "ACTIVE" || ["CONSUMED", "CANCELLED"].includes(challenge.status)) throw new LoginChallengeError("INVALID_CHALLENGE");
  if (challenge.expiresAt <= now || challenge.status === "EXPIRED") throw new LoginChallengeError("CHALLENGE_EXPIRED");
  if (challenge.status === "LOCKED" || challenge.attemptCount >= challenge.maxAttempts) throw new LoginChallengeError("CHALLENGE_LOCKED");
}

function resendKey(id: string) { return `hflive:login-resend:${id}`; }

export async function getLoginChallengeStatus(database: PrismaClient, bindingDigest: string, now = new Date()) {
  const challenge = await database.loginChallenge.findUnique({ where: { bindingDigest }, include: { user: { select: { accountStatus: true, email: true } } } });
  assertPending(challenge, now);
  const current = challenge!;
  const rate = await database.rateLimit.findUnique({ where: { key: resendKey(current.id) } });
  return {
    serverTime: now.getTime(),
    maskedEmail: maskLoginEmail(current.user.email),
    expiresAt: current.expiresAt.toISOString(),
    resendAt: new Date(Number(rate?.lastRequest ?? current.createdAt.getTime()) + LOGIN_RESEND_COOLDOWN_MS).toISOString(),
    remainingAttempts: current.maxAttempts - current.attemptCount,
    canResend: (rate?.count ?? 0) < MAX_RESENDS,
  };
}

export async function rotateLoginChallengeOtp(database: PrismaClient, input: { bindingDigest: string; otpDigest: string; now?: Date }) {
  const now = input.now ?? new Date();
  return database.$transaction(async (transaction) => {
    // Share the row lock with verification's conditional UPDATE: a consumed challenge cannot be renewed.
    await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "loginChallenge" WHERE "bindingDigest" = ${input.bindingDigest} FOR UPDATE`);
    const challenge = await transaction.loginChallenge.findUnique({ where: { bindingDigest: input.bindingDigest }, include: { user: { select: { accountStatus: true, email: true } } } });
    assertPending(challenge, now);
    const current = challenge!;
    const key = resendKey(current.id);
    const rate = await transaction.rateLimit.findUnique({ where: { key } });
    const retryAt = new Date(Number(rate?.lastRequest ?? current.createdAt.getTime()) + LOGIN_RESEND_COOLDOWN_MS);
    if (retryAt > now || (rate?.count ?? 0) >= MAX_RESENDS) throw new LoginChallengeError("RESEND_LIMITED", retryAt);
    await transaction.rateLimit.upsert({ where: { key }, create: { key, count: 1, lastRequest: BigInt(now.getTime()) }, update: { count: { increment: 1 }, lastRequest: BigInt(now.getTime()) } });
    await transaction.loginChallenge.update({ where: { id: current.id }, data: { otpDigest: input.otpDigest } });
    // Re-sending never extends the original lifetime or resets failed attempts.
    return { id: current.id, userId: current.userId, email: current.user.email, expiresAt: current.expiresAt, previousOtpDigest: current.otpDigest };
  });
}
