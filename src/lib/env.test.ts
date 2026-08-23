import { afterEach, describe, expect, it, vi } from "vitest";

describe("environment contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("requires transactional email in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEPLOYMENT_MODE", "official");
    vi.stubEnv("BETTER_AUTH_URL", "https://auth.hsfz.live");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-secure-secret-that-is-longer-than-32-characters");
    vi.stubEnv("SECURITY_HASH_SECRET", "a-separate-hash-secret-longer-than-32-characters");
    vi.stubEnv("OUTBOX_WORKER_SECRET", "a-separate-worker-secret-longer-than-32-characters");
    vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/auth");
    vi.stubEnv("DIRECT_DATABASE_URL", "postgresql://example.invalid/auth");
    vi.stubEnv("MAIL_ENABLED", "false");

    const { getServerEnv } = await import("./env");

    expect(() => getServerEnv()).toThrow(/transactional email/i);
  });

  it("allows an explicitly degraded self-hosted production instance", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEPLOYMENT_MODE", "self_hosted");
    vi.stubEnv("BETTER_AUTH_URL", "https://auth.example.test");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-secure-secret-that-is-longer-than-32-characters");
    vi.stubEnv("SECURITY_HASH_SECRET", "a-separate-hash-secret-longer-than-32-characters");
    vi.stubEnv("OUTBOX_WORKER_SECRET", "a-separate-worker-secret-longer-than-32-characters");
    vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/auth");
    vi.stubEnv("DIRECT_DATABASE_URL", "postgresql://example.invalid/auth");
    vi.stubEnv("MAIL_ENABLED", "false");

    const { getServerEnv } = await import("./env");

    expect(getServerEnv().MAIL_ENABLED).toBe(false);
  });

  it("requires a dedicated digest secret in every production deployment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEPLOYMENT_MODE", "self_hosted");
    vi.stubEnv("BETTER_AUTH_URL", "https://auth.example.test");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-secure-secret-that-is-longer-than-32-characters");
    vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/auth");
    vi.stubEnv("DIRECT_DATABASE_URL", "postgresql://example.invalid/auth");
    vi.stubEnv("MAIL_ENABLED", "false");
    vi.stubEnv("SECURITY_HASH_SECRET", "");
    vi.stubEnv("OUTBOX_WORKER_SECRET", "a-separate-worker-secret-longer-than-32-characters");

    const { getServerEnv } = await import("./env");

    expect(() => getServerEnv()).toThrow(/SECURITY_HASH_SECRET/);
  });

  it("requires avatar storage in official production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEPLOYMENT_MODE", "official");
    vi.stubEnv("BETTER_AUTH_URL", "https://auth.hsfz.live");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-secure-secret-that-is-longer-than-32-characters");
    vi.stubEnv("SECURITY_HASH_SECRET", "a-separate-hash-secret-longer-than-32-characters");
    vi.stubEnv("OUTBOX_WORKER_SECRET", "a-separate-worker-secret-longer-than-32-characters");
    vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/auth");
    vi.stubEnv("DIRECT_DATABASE_URL", "postgresql://example.invalid/auth");
    vi.stubEnv("MAIL_ENABLED", "true");
    vi.stubEnv("OBJECT_STORAGE_ENABLED", "false");
    const { getServerEnv } = await import("./env");
    expect(() => getServerEnv()).toThrow(/object storage/i);
  });

  it("requires the complete S3 contract when avatar storage is enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEPLOYMENT_MODE", "self_hosted");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-secure-secret-that-is-longer-than-32-characters");
    vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/auth");
    vi.stubEnv("DIRECT_DATABASE_URL", "postgresql://example.invalid/auth");
    vi.stubEnv("OBJECT_STORAGE_ENABLED", "true");
    vi.stubEnv("S3_ENDPOINT", "");
    const { getServerEnv } = await import("./env");
    expect(() => getServerEnv()).toThrow(/S3_ENDPOINT/);
  });

  it("rejects a non-HTTPS outbox wake URL", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEPLOYMENT_MODE", "self_hosted");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-secure-secret-that-is-longer-than-32-characters");
    vi.stubEnv("DATABASE_URL", "postgresql://example.invalid/auth");
    vi.stubEnv("DIRECT_DATABASE_URL", "postgresql://example.invalid/auth");
    vi.stubEnv("OUTBOX_WAKE_URL", "http://example.invalid/wake");
    const { getServerEnv } = await import("./env");
    expect(() => getServerEnv()).toThrow(/OUTBOX_WAKE_URL/);
  });
});
