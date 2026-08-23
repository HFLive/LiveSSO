import { afterEach, describe, expect, it, vi } from "vitest";

const requiredEnv = {
  NODE_ENV: "development",
  DEPLOYMENT_MODE: "self_hosted",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "a-secure-secret-that-is-longer-than-32-characters",
  DATABASE_URL: "postgresql://example.invalid/auth",
  DIRECT_DATABASE_URL: "postgresql://example.invalid/auth",
  OUTBOX_WORKER_SECRET: "a-separate-worker-secret-longer-than-32-characters",
} as const;

describe("markOutboxPending", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does nothing when OUTBOX_WAKE_URL is unset", async () => {
    for (const [key, value] of Object.entries(requiredEnv)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("OUTBOX_WAKE_URL", "");
    const fetchImpl = vi.fn();
    const { markOutboxPending } = await import("./outbox-pending");
    await markOutboxPending({ fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts a bearer wake request and does not follow redirects", async () => {
    for (const [key, value] of Object.entries(requiredEnv)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv(
      "OUTBOX_WAKE_URL",
      "https://hflive-auth-outbox-scheduler.example.workers.dev/wake",
    );
    const fetchImpl = vi.fn().mockResolvedValue({
      body: { cancel: vi.fn() },
    });
    const { markOutboxPending } = await import("./outbox-pending");
    await markOutboxPending({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [target, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(target).toBe(
      "https://hflive-auth-outbox-scheduler.example.workers.dev/wake",
    );
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${requiredEnv.OUTBOX_WORKER_SECRET}`,
        "user-agent": "hflive-auth/outbox-wake",
      },
    });
  });

  it("swallows wake failures so the originating write still commits", async () => {
    for (const [key, value] of Object.entries(requiredEnv)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv(
      "OUTBOX_WAKE_URL",
      "https://hflive-auth-outbox-scheduler.example.workers.dev/wake",
    );
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const { markOutboxPending } = await import("./outbox-pending");
    await expect(
      markOutboxPending({ fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeUndefined();
  });
});
