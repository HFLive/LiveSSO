import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlerGet: vi.fn(),
}));

vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({
    GET: mocks.handlerGet,
    POST: vi.fn(),
    PATCH: vi.fn(),
    PUT: vi.fn(),
    DELETE: vi.fn(),
  }),
}));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: { oauthClient: { findUnique: vi.fn() } },
}));

import { GET } from "./[...all]/route";

describe("Better Auth route cache policy", () => {
  beforeEach(() => {
    mocks.handlerGet.mockReset();
  });

  it("allows successful JWKS responses to be reused briefly", async () => {
    mocks.handlerGet.mockResolvedValue(
      Response.json({ keys: [] }, { headers: { "x-upstream": "preserved" } }),
    );

    const response = await GET(new Request("https://auth.hsfz.live/api/auth/jwks"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, stale-while-revalidate=300",
    );
    expect(response.headers.get("x-upstream")).toBe("preserved");
  });

  it("does not replace cache policy on other auth responses", async () => {
    mocks.handlerGet.mockResolvedValue(
      Response.json(null, { headers: { "cache-control": "no-store", pragma: "no-cache" } }),
    );

    const response = await GET(new Request("https://auth.hsfz.live/api/auth/get-session"));

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("does not cache failed JWKS responses", async () => {
    mocks.handlerGet.mockResolvedValue(
      Response.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }),
    );

    const response = await GET(new Request("https://auth.hsfz.live/api/auth/jwks"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
