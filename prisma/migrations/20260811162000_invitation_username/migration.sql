ALTER TABLE "invitation"
ADD COLUMN "username" VARCHAR(32);

ALTER TABLE "invitation"
ADD CONSTRAINT "invitation_username_format_check" CHECK (
  "username" IS NULL OR "username" ~ '^[A-Za-z0-9_]{3,32}$'
);

-- A username is reserved only while its invitation is pending. Historical
-- invitations remain available for audit without permanently blocking reuse.
CREATE UNIQUE INDEX "invitation_one_pending_per_username"
    ON "invitation" (LOWER("username"))
 WHERE "status" = 'PENDING'::"InvitationStatus" AND "username" IS NOT NULL;
