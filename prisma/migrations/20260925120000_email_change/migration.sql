-- CreateEnum
CREATE TYPE "EmailChangeStatus" AS ENUM ('PENDING', 'CONSUMED', 'LOCKED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "emailChangeRequest" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "userId" UUID NOT NULL,
    "newEmail" TEXT NOT NULL,
    "otpDigest" VARCHAR(80) NOT NULL,
    "status" "EmailChangeStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "ipDigest" VARCHAR(80),
    "userAgentDigest" VARCHAR(80),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emailChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emailChangeRequest_userId_status_idx" ON "emailChangeRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "emailChangeRequest_newEmail_status_idx" ON "emailChangeRequest"("newEmail", "status");

-- CreateIndex
CREATE INDEX "emailChangeRequest_status_expiresAt_idx" ON "emailChangeRequest"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "emailChangeRequest" ADD CONSTRAINT "emailChangeRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Database-enforced single pending request per account and destination.
CREATE UNIQUE INDEX "emailChangeRequest_pending_user_key" ON "emailChangeRequest" ("userId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "emailChangeRequest_pending_email_key" ON "emailChangeRequest" (lower("newEmail")) WHERE "status" = 'PENDING';
ALTER TABLE "emailChangeRequest" ADD CONSTRAINT "emailChangeRequest_attempts_check" CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0 AND "attemptCount" <= "maxAttempts");
