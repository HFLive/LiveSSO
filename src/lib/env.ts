import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.url().optional(),
);

const serverSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DEPLOYMENT_MODE: z.enum(["official", "self_hosted"]).default("self_hosted"),
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    SECURITY_HASH_SECRET: z.string().min(32).optional(),
    DATABASE_URL: z.string().min(1),
    DIRECT_DATABASE_URL: z.string().min(1),
    TRUSTED_ORIGINS: z.string().default(""),
    MAIL_ENABLED: booleanString,
    MAIL_FROM: z.string().default("HFLive Auth <auth@hsfz.live>"),
    MAIL_TRANSPORT: z.enum(["smtp", "http"]).default("smtp"),
    MAIL_SMTP_HOST: z.string().default("localhost"),
    MAIL_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(51025),
    MAIL_SMTP_SECURE: booleanString,
    MAIL_SMTP_USER: z.string().optional(),
    MAIL_SMTP_PASSWORD: z.string().optional(),
    MAIL_API_URL: optionalUrl,
    MAIL_API_TOKEN: z.string().optional(),
    OBJECT_STORAGE_ENABLED: booleanString,
    S3_ENDPOINT: optionalUrl,
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: z.string().min(3).max(63).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: booleanString,
    OUTBOX_WORKER_SECRET: z.string().min(32).optional(),
    CRON_SECRET: z.string().min(32).optional(),
    OUTBOX_WAKE_URL: optionalUrl,
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && !value.SECURITY_HASH_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["SECURITY_HASH_SECRET"],
        message: "Production requires a dedicated SECURITY_HASH_SECRET for OTP and opaque token digests.",
      });
    }

    if (value.NODE_ENV === "production" && value.DEPLOYMENT_MODE === "official" && !value.MAIL_ENABLED) {
      context.addIssue({
        code: "custom",
        path: ["MAIL_ENABLED"],
        message: "Official production requires transactional email. Set MAIL_ENABLED=true after configuring a provider.",
      });
    }

    if (value.MAIL_ENABLED && value.MAIL_TRANSPORT === "http" && !value.MAIL_API_URL) {
      context.addIssue({
        code: "custom",
        path: ["MAIL_API_URL"],
        message: "HTTP mail transport requires MAIL_API_URL.",
      });
    }
    if (value.NODE_ENV === "production" && value.DEPLOYMENT_MODE === "official" && !value.OBJECT_STORAGE_ENABLED) {
      context.addIssue({ code: "custom", path: ["OBJECT_STORAGE_ENABLED"], message: "Official production requires object storage for profile avatars." });
    }
    if (value.OBJECT_STORAGE_ENABLED) {
      for (const field of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        if (!value[field]) context.addIssue({ code: "custom", path: [field], message: `Object storage requires ${field}.` });
      }
    }
    if (value.NODE_ENV === "production" && !value.OUTBOX_WORKER_SECRET && !value.CRON_SECRET) {
      context.addIssue({ code: "custom", path: ["OUTBOX_WORKER_SECRET"], message: "Production requires OUTBOX_WORKER_SECRET or Vercel CRON_SECRET for reliable event dispatch." });
    }
    if (value.OUTBOX_WAKE_URL) {
      try {
        const wake = new URL(value.OUTBOX_WAKE_URL);
        if (wake.protocol !== "https:" && wake.hostname !== "localhost") {
          context.addIssue({
            code: "custom",
            path: ["OUTBOX_WAKE_URL"],
            message: "OUTBOX_WAKE_URL must use HTTPS.",
          });
        }
      } catch {
        context.addIssue({
          code: "custom",
          path: ["OUTBOX_WAKE_URL"],
          message: "OUTBOX_WAKE_URL must be a valid URL.",
        });
      }
    }
  });

let cachedEnv: z.infer<typeof serverSchema> | undefined;

export function getServerEnv() {
  cachedEnv ??= serverSchema.parse(process.env);
  return cachedEnv;
}

export function getTrustedOrigins() {
  return getServerEnv()
    .TRUSTED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getSecurityHashSecret() {
  const env = getServerEnv();
  return env.SECURITY_HASH_SECRET ?? env.BETTER_AUTH_SECRET;
}
