import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { getLoginApplication } from "./login-application";

describe("login application context", () => {
  it("shows a name only for approved applications with exact registered callbacks", async () => {
    const findUnique = vi.fn().mockResolvedValue({ name: "LiveBoard", disabled: false, approvalStatus: "APPROVED", redirectUris: ["https://app.example/callback"], scopes: ["openid"] });
    const database = { oauthClient: { findUnique } } as unknown as PrismaClient;
    const query = new URLSearchParams({ client_id: "example", response_type: "code", redirect_uri: "https://app.example/callback", scope: "openid" });
    await expect(getLoginApplication(database, `https://auth.hsfz.live/sign-in?${query}`)).resolves.toBe("LiveBoard");
    query.set("redirect_uri", "https://app.example/callback/other");
    await expect(getLoginApplication(database, `https://auth.hsfz.live/sign-in?${query}`)).resolves.toBeUndefined();
    findUnique.mockClear();
    await expect(getLoginApplication(database, `https://auth.hsfz.live/sign-in?callbackURL=${encodeURIComponent(`https://untrusted.example/api/auth/oauth2/authorize?${query}`)}`)).resolves.toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });
  it.each([
    { disabled: true, approvalStatus: "APPROVED", scopes: ["openid"] },
    { disabled: false, approvalStatus: "PENDING", scopes: ["openid"] },
    { disabled: false, approvalStatus: "APPROVED", scopes: ["profile"] },
  ])("hides context when the application or requested scope is unavailable", async (configuration) => {
    const database = { oauthClient: { findUnique: vi.fn().mockResolvedValue({ name: "LiveBoard", redirectUris: ["https://app.example/callback"], ...configuration }) } } as unknown as PrismaClient;
    const query = new URLSearchParams({ client_id: "example", response_type: "code", redirect_uri: "https://app.example/callback", scope: "openid" });
    await expect(getLoginApplication(database, `https://auth.hsfz.live/sign-in?${query}`)).resolves.toBeUndefined();
  });
  it("does not trust a callback containing URL credentials", async () => {
    const findUnique = vi.fn();
    const database = { oauthClient: { findUnique } } as unknown as PrismaClient;
    const callback = "https://name@auth.hsfz.live/api/auth/oauth2/authorize?client_id=example&response_type=code&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback";
    await expect(getLoginApplication(database, `https://auth.hsfz.live/sign-in?callbackURL=${encodeURIComponent(callback)}`)).resolves.toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
