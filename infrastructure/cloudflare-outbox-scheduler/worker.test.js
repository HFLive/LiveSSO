import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchOutbox,
  runScheduled,
  shouldDispatch,
} from "./worker.js";

const env = {
  AUTH_ORIGIN: "https://auth.hsfz.live",
  OUTBOX_WORKER_SECRET: "test-worker-secret-value",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Cloudflare outbox scheduler", () => {
  it("dispatches with bearer authentication without following redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ claimed: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(dispatchOutbox(env)).resolves.toEqual({ claimed: 1 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    expect(target.toString()).toBe("https://auth.hsfz.live/api/internal/outbox/dispatch");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: {
        authorization: `Bearer ${env.OUTBOX_WORKER_SECRET}`,
        "user-agent": "hflive-auth-outbox-scheduler/1.0",
      },
    });
  });

  it("rejects a non-HTTPS origin before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(dispatchOutbox({ ...env, AUTH_ORIGIN: "http://localhost:3000" })).rejects.toThrow(
      "AUTH_ORIGIN must use HTTPS.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails on a non-success response without reading its body", async () => {
    const response = new Response("sensitive upstream detail", { status: 401 });
    const textSpy = vi.spyOn(response, "text");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(dispatchOutbox(env)).rejects.toThrow("Outbox dispatch failed with HTTP 401.");
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("skips Neon when the pending flag is absent", async () => {
    const kv = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn(),
      delete: vi.fn(),
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runScheduled({ ...env, OUTBOX_PENDING: kv }, new Date("2026-08-23T12:00:00.000Z")),
    ).resolves.toEqual({ skipped: true, claimed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.delete).not.toHaveBeenCalled();
  });

  it("dispatches when the pending flag is set and clears it after an empty claim", async () => {
    const kv = {
      get: vi.fn().mockResolvedValue("1"),
      put: vi.fn(),
      delete: vi.fn(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ claimed: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(runScheduled({ ...env, OUTBOX_PENDING: kv })).resolves.toEqual({
      skipped: false,
      claimed: 0,
    });
    expect(kv.delete).toHaveBeenCalledWith("pending");
  });

  it("keeps dispatching without KV so an unmigrated worker does not drop events", async () => {
    await expect(shouldDispatch(env)).resolves.toEqual({ reason: "no-kv" });
  });
});
