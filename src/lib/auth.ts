import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { jwt, username } from "better-auth/plugins";
import { getServerEnv, getTrustedOrigins } from "@/lib/env";
import { sendSecurityNotice, sendTransactionalMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { riskAuthPlugin, TRUST_MS } from "@/lib/risk-auth-plugin";
import { profileEmailPlugin } from "@/lib/profile-email-plugin";

const env = getServerEnv();
const OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "directory:user:read",
  "directory:user:status",
] as const;

function preferredUsername(user: Record<string, unknown>) {
  return typeof user.username === "string" ? user.username : undefined;
}

export const auth = betterAuth({
  appName: "HFLive Auth",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  trustedOrigins: getTrustedOrigins(),
  databaseHooks: {
    session: {
      update: {
        before: async (update, ctx) => {
          const session = ctx?.context.session?.session;
          if (!session || !update.expiresAt) return;
          // Preserve the stored expiry of sessions created before the absolute limit.
          const deadline = Math.max(session.createdAt.getTime() + TRUST_MS, session.expiresAt.getTime());
          return { data: { expiresAt: new Date(Math.min(update.expiresAt.getTime(), deadline)) } };
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      try { await sendTransactionalMail({
        to: user.email,
        subject: "重置你的 HFLive Auth 密码",
        text: `请在 1 小时内打开以下链接重置密码：\n${url}\n\n如果不是你发起的请求，请忽略这封邮件。`,
      }); } catch {
        // Delivery failures must not distinguish an existing mailbox from an unknown account.
        await prisma.auditEvent.create({ data: { eventType: "account.recovery.delivery_failed", actorType: "SYSTEM", subjectUserId: user.id, outcome: "FAILURE", severity: "WARNING", expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000) } }).catch(() => undefined);
      }
    },
    onPasswordReset: async ({ user }) => {
      await prisma.emailChangeRequest.updateMany({
        where: { userId: user.id, status: "PENDING" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await sendSecurityNotice(user.email, "你的 HFLive Auth 密码已重置，其他会话已撤销。" ).catch(() => undefined);
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-in/username": { window: 60, max: 10 },
    },
  },
  advanced: {
    database: {
      generateId: "uuid",
    },
    useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
  },
  disabledPaths: ["/token", "/sign-in/email", "/sign-in/username", "/sign-up/email"],
  telemetry: {
    enabled: false,
  },
  plugins: [
    riskAuthPlugin(),
    profileEmailPlugin(),
    username({
      minUsernameLength: 3,
      maxUsernameLength: 32,
      usernameValidator: (value) => /^[a-zA-Z0-9_]+$/.test(value),
    }),
    jwt({
      disableSettingJwtHeader: true,
      jwt: {
        issuer: env.BETTER_AUTH_URL,
        audience: env.BETTER_AUTH_URL,
        expirationTime: "15m",
      },
      jwks: {
        rotationInterval: 30 * 24 * 60 * 60,
        gracePeriod: 30 * 24 * 60 * 60,
      },
    }),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      scopes: [...OAUTH_SCOPES],
      resources: [{ identifier: env.BETTER_AUTH_URL, allowedScopes: [...OAUTH_SCOPES] }],
      enforcePerClientResources: false,
      resourcePrivileges: () => false,
      allowDynamicClientRegistration: false,
      allowUnauthenticatedClientRegistration: false,
      clientPrivileges: () => false,
      accessTokenExpiresIn: 15 * 60,
      idTokenExpiresIn: 15 * 60,
      refreshTokenExpiresIn: 30 * 24 * 60 * 60,
      codeExpiresIn: 5 * 60,
      storeClientSecret: "hashed",
      storeTokens: "hashed",
      customUserInfoClaims: ({ user }) => ({
        preferred_username: preferredUsername(user),
      }),
      customIdTokenClaims: ({ user }) => ({
        preferred_username: preferredUsername(user),
      }),
      advertisedMetadata: {
        scopes_supported: [...OAUTH_SCOPES],
        claims_supported: [
          "sub",
          "iss",
          "aud",
          "exp",
          "iat",
          "sid",
          "scope",
          "azp",
          "email",
          "email_verified",
          "preferred_username",
          "name",
          "picture",
        ],
      },
    }),
  ],
});
