BEGIN;

-- AlterTable
ALTER TABLE "jwks" ADD COLUMN     "alg" TEXT,
ADD COLUMN     "crv" TEXT;

-- AlterTable
ALTER TABLE "oauthClient" ADD COLUMN     "applicationType" TEXT,
ADD COLUMN     "backchannelLogoutSessionRequired" BOOLEAN,
ADD COLUMN     "backchannelLogoutUri" TEXT,
ADD COLUMN     "clientCredentialsScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "clientDiscoveryId" TEXT,
ADD COLUMN     "dpopBoundAccessTokens" BOOLEAN DEFAULT false,
ADD COLUMN     "jwks" TEXT,
ADD COLUMN     "jwksUri" TEXT;

-- AlterTable
ALTER TABLE "oauthRefreshToken" ADD COLUMN     "authorizationCodeId" TEXT,
ADD COLUMN     "confirmation" JSONB,
ADD COLUMN     "requestedUserInfoClaims" TEXT[],
ADD COLUMN     "resources" TEXT[],
ADD COLUMN     "rotatedAt" TIMESTAMP(3),
ADD COLUMN     "rotationReplayExpiresAt" TIMESTAMP(3),
ADD COLUMN     "rotationReplayResponse" TEXT;

-- AlterTable
ALTER TABLE "oauthAccessToken" ADD COLUMN     "authorizationCodeId" TEXT,
ADD COLUMN     "confirmation" JSONB,
ADD COLUMN     "requestedUserInfoClaims" TEXT[],
ADD COLUMN     "resources" TEXT[],
ADD COLUMN     "revoked" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "oauthConsent" ADD COLUMN     "requestedUserInfoClaims" TEXT[],
ADD COLUMN     "resources" TEXT[];

-- CreateTable
CREATE TABLE "oauthResource" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessTokenTtl" INTEGER,
    "refreshTokenTtl" INTEGER,
    "signingAlgorithm" TEXT,
    "signingKeyId" TEXT,
    "allowedScopes" TEXT[],
    "customClaims" JSONB,
    "dpopBoundAccessTokensRequired" BOOLEAN DEFAULT false,
    "disabled" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "policyVersion" INTEGER DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "oauthResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauthClientResource" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "clientId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "oauthClientResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauthClientAssertion" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauthClientAssertion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauthResource_identifier_key" ON "oauthResource"("identifier");

-- CreateIndex
CREATE INDEX "oauthClientResource_clientId_idx" ON "oauthClientResource"("clientId");

-- CreateIndex
CREATE INDEX "oauthClientResource_resourceId_idx" ON "oauthClientResource"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "oauthClientResource_clientId_resourceId_key" ON "oauthClientResource"("clientId", "resourceId");

-- CreateIndex
CREATE INDEX "oauthRefreshToken_authorizationCodeId_idx" ON "oauthRefreshToken"("authorizationCodeId");

-- CreateIndex
CREATE INDEX "oauthAccessToken_authorizationCodeId_idx" ON "oauthAccessToken"("authorizationCodeId");

-- AddForeignKey
ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "oauthResource"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the provider's machine permissions in sync while 1.6 and 1.7
-- binaries overlap during deploy or rollback.
CREATE FUNCTION sync_oauth_client_credentials_scopes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW."clientCredentialsScopes" := ARRAY(
    SELECT scope
    FROM unnest(NEW."scopes") AS granted(scope)
    WHERE 'client_credentials' = ANY(NEW."grantTypes")
      AND scope IN ('directory:user:read', 'directory:user:status')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER oauth_client_credentials_scopes
BEFORE INSERT OR UPDATE OF "scopes", "grantTypes", "clientCredentialsScopes" ON "oauthClient"
FOR EACH ROW EXECUTE FUNCTION sync_oauth_client_credentials_scopes();

-- Fire the same derivation for existing machine clients.
UPDATE "oauthClient"
SET "clientCredentialsScopes" = DEFAULT
WHERE 'client_credentials' = ANY("grantTypes");

COMMIT;
