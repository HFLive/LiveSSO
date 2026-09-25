import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { markOutboxPending } from "@/lib/security/outbox-pending";
import {
  cancelPendingEmailChangeRequests,
  consumeEmailChangeRequest,
  expireStaleEmailChangeRequests,
  recordEmailChangeFailure,
} from "@/lib/security/domain-store";

const PROFILE_RETENTION_MS = 400 * 24 * 60 * 60 * 1_000;

export const EMAIL_CHANGE_OTP_TTL_MS = 10 * 60 * 1_000;

export type EmailChangeErrorCode =
  | "INVALID_EMAIL"
  | "EMAIL_TAKEN"
  | "EMAIL_RESERVED"
  | "SAME_EMAIL"
  | "NO_PENDING_REQUEST"
  | "INVALID_OTP"
  | "ACCOUNT_NOT_ACTIVE"
  | "MAIL_DELIVERY_FAILED";

export class EmailChangeError extends Error {
  readonly code: EmailChangeErrorCode;

  constructor(code: EmailChangeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function normalizeNewEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!z.email().max(254).safeParse(email).success) {
    throw new EmailChangeError("INVALID_EMAIL", "请输入有效的新邮箱地址。");
  }
  return email;
}

export async function getPendingEmailChange(
  database: PrismaClient,
  userId: string,
  now = new Date(),
) {
  return database.emailChangeRequest.findFirst({
    where: { userId, status: "PENDING", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { newEmail: true, expiresAt: true },
  });
}

/**
 * 发起邮箱更改：校验新邮箱可用性，替换本用户已有的待验证请求，
 * 写入新的 OTP 摘要。邮件发送由调用方在成功后执行；失败时仅按
 * 返回的 requestId 撤销本次请求，避免取消并发发起的新请求。
 */
export async function requestEmailChange(
  database: PrismaClient,
  input: {
    userId: string;
    newEmail: string;
    otpDigest: string;
    ipDigest?: string;
    userAgentDigest?: string;
    now?: Date;
  },
) {
  const newEmail = normalizeNewEmail(input.newEmail);
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + EMAIL_CHANGE_OTP_TTL_MS);

  return database.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "user" WHERE "id" = ${input.userId}::uuid FOR UPDATE`,
    );
    const current = await transaction.user.findUnique({
      where: { id: input.userId },
      select: { email: true, accountStatus: true },
    });
    if (!current || current.accountStatus !== "ACTIVE") {
      throw new EmailChangeError("ACCOUNT_NOT_ACTIVE", "当前账号不能修改邮箱。");
    }
    if (current.email.toLowerCase() === newEmail) {
      throw new EmailChangeError("SAME_EMAIL", "新邮箱不能与当前邮箱相同。");
    }

    await expireStaleEmailChangeRequests(transaction, now);

    const taken = await transaction.user.findFirst({
      where: { email: { equals: newEmail, mode: "insensitive" } },
      select: { id: true },
    });
    if (taken && taken.id !== input.userId) {
      throw new EmailChangeError("EMAIL_TAKEN", "该邮箱暂时无法使用，请选择其他邮箱。");
    }
    const invited = await transaction.invitation.findFirst({
      where: { normalizedEmail: newEmail, status: "PENDING", expiresAt: { gt: now } },
      select: { id: true },
    });
    if (invited) {
      throw new EmailChangeError("EMAIL_RESERVED", "该邮箱暂时无法使用，请选择其他邮箱。");
    }
    const requested = await transaction.emailChangeRequest.findFirst({
      where: {
        newEmail: { equals: newEmail, mode: "insensitive" },
        status: "PENDING",
        expiresAt: { gt: now },
        userId: { not: input.userId },
      },
      select: { id: true },
    });
    if (requested) {
      throw new EmailChangeError("EMAIL_RESERVED", "该邮箱暂时无法使用，请选择其他邮箱。");
    }

    await cancelPendingEmailChangeRequests(transaction, { userId: input.userId, now });
    const created = await transaction.emailChangeRequest.create({
      data: {
        userId: input.userId,
        newEmail,
        otpDigest: input.otpDigest,
        expiresAt,
        ...(input.ipDigest ? { ipDigest: input.ipDigest } : {}),
        ...(input.userAgentDigest ? { userAgentDigest: input.userAgentDigest } : {}),
      },
    });
    await transaction.auditEvent.create({
      data: {
        eventType: "user.email.change.requested",
        actorType: "USER",
        actorUserId: input.userId,
        subjectUserId: input.userId,
        outcome: "SUCCESS",
        metadata: { requestId: created.id },
        expiresAt: new Date(now.getTime() + PROFILE_RETENTION_MS),
      },
    });
    return { requestId: created.id, newEmail, expiresAt };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * 用 OTP 确认邮箱更改：原子消费请求后，在同一事务内更新用户邮箱、
 * 邮箱验证状态、credential accountId，并为订阅 client 生成
 * user.profile.changed outbox 与审计。
 */
export async function confirmEmailChange(
  database: PrismaClient,
  input: { userId: string; otpDigest: string; now?: Date },
) {
  const now = input.now ?? new Date();
  try {
    const result = await database.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "user" WHERE "id" = ${input.userId}::uuid FOR UPDATE`,
      );
      const current = await transaction.user.findUnique({
        where: { id: input.userId },
        select: { email: true, accountStatus: true },
      });
      if (!current || current.accountStatus !== "ACTIVE") {
        throw new EmailChangeError("ACCOUNT_NOT_ACTIVE", "当前账号不能修改邮箱。");
      }
      const pending = await transaction.emailChangeRequest.findFirst({
        where: { userId: input.userId, status: "PENDING", expiresAt: { gt: now } },
        orderBy: { createdAt: "desc" },
      });
      if (!pending) throw new EmailChangeError("NO_PENDING_REQUEST", "没有待验证的请求，请重新发起。");
      const consumed = await consumeEmailChangeRequest(transaction, {
        id: pending.id, userId: input.userId, otpDigest: input.otpDigest, now,
      });
      if (!consumed) {
        await recordEmailChangeFailure(transaction, { id: pending.id, userId: input.userId, now });
        // Return the failure so its attempt counter is committed.
        return null;
      }
      const taken = await transaction.user.findFirst({
        where: { email: { equals: pending.newEmail, mode: "insensitive" }, id: { not: input.userId } },
      });
      const reserved = await transaction.invitation.findFirst({
        where: { normalizedEmail: pending.newEmail, status: "PENDING", expiresAt: { gt: now } },
      });
      if (taken || reserved) throw new EmailChangeError("EMAIL_TAKEN", "该邮箱暂时无法使用，请选择其他邮箱。");
      if (current.email.toLowerCase() !== pending.newEmail.toLowerCase()) {
        await transaction.user.update({
          where: { id: input.userId },
          data: { email: pending.newEmail, emailVerified: true },
        });
        await transaction.account.updateMany({
          where: { userId: input.userId, providerId: "credential" },
          data: { accountId: pending.newEmail },
        });
      }

      await transaction.loginChallenge.updateMany({
        where: { userId: input.userId, status: "PENDING" },
        data: { status: "CANCELLED", cancelledAt: now },
      });
      await transaction.verification.deleteMany({
        where: { value: input.userId, identifier: { startsWith: "reset-password:" } },
      });
      const webhooks = await transaction.clientWebhook.findMany({
        where: {
          active: true,
          eventTypes: { has: "user.profile.changed" },
          client: { disabled: false, approvalStatus: "APPROVED" },
        },
        select: { id: true, clientId: true },
      });
      const changeId = randomUUID();
      await Promise.all(
        webhooks.map((webhook) =>
          transaction.outboxEvent.create({
            data: {
              aggregateType: "user",
              aggregateId: input.userId,
              eventType: "user.profile.changed",
              idempotencyKey: `user-profile:${input.userId}:email:${changeId}:${webhook.id}`,
              payload: {
                webhookId: webhook.id,
                clientId: webhook.clientId,
                subject: input.userId,
                email: pending.newEmail,
                occurredAt: now.toISOString(),
              },
            },
          }),
        ),
      );
      await transaction.auditEvent.create({
        data: {
          eventType: "user.email.changed",
          actorType: "USER",
          actorUserId: input.userId,
          subjectUserId: input.userId,
          outcome: "SUCCESS",
          severity: "WARNING",
          metadata: { deliveryCount: webhooks.length },
          expiresAt: new Date(now.getTime() + PROFILE_RETENTION_MS),
        },
      });
      return { oldEmail: current.email, newEmail: pending.newEmail, deliveryCount: webhooks.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (!result) throw new EmailChangeError("INVALID_OTP", "验证码错误或已过期，请重试。");
    if (result.deliveryCount > 0) await markOutboxPending();
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new EmailChangeError("EMAIL_TAKEN", "该邮箱暂时无法使用，请选择其他邮箱。");
    }
    throw error;
  }
}

export async function cancelEmailChange(
  database: PrismaClient,
  input: { userId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const cancelled = await cancelPendingEmailChangeRequests(database, { userId: input.userId, now });
  if (cancelled > 0) {
    await database.auditEvent.create({
      data: {
        eventType: "user.email.change.cancelled",
        actorType: "USER",
        actorUserId: input.userId,
        subjectUserId: input.userId,
        outcome: "SUCCESS",
        metadata: { cancelledCount: cancelled },
        expiresAt: new Date(now.getTime() + PROFILE_RETENTION_MS),
      },
    });
  }
  return { cancelled: cancelled > 0 };
}
