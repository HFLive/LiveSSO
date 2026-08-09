import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchOutbox } from "./worker.js";

const env = {
  AUTH_ORIGIN: "https://auth.hsfz.live",
  OUTBOX_WORKER_SECRET: "test-worker-secret-value",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Cloudflare outbox scheduler", () => {
  it("dispatches with bearer authentication without following redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await dispatchOutbox(env);

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
});
