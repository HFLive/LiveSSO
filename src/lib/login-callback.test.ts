import { describe, expect, it } from "vitest";
import { resolveLoginCallback } from "./login-callback";

describe("login callback resolution", () => {
  it("keeps an explicit callback URL", () => {
    expect(
      resolveLoginCallback(
        "https://auth.hsfz.live/sign-in?callbackURL=%2Fprofile",
      ),
    ).toBe("/profile");
  });

  it("returns the original OIDC authorization request after first login", () => {
    const current =
      "https://auth.hsfz.live/sign-in?client_id=liveboard&redirect_uri=https%3A%2F%2Fboard.hsfz.live%2Fapi%2Fauth%2Fhflive%2Fcallback&response_type=code&scope=openid&state=state-1&code_challenge=challenge&code_challenge_method=S256";
    const result = new URL(resolveLoginCallback(current) ?? "");

    expect(result.origin).toBe("https://auth.hsfz.live");
    expect(result.pathname).toBe("/api/auth/oauth2/authorize");
    expect(result.searchParams.get("client_id")).toBe("liveboard");
    expect(result.searchParams.get("state")).toBe("state-1");
  });

  it("supports Better Auth's resume query and ignores unrelated sign-in queries", () => {
    expect(
      resolveLoginCallback(
        "https://auth.hsfz.live/sign-in?client_id=liveboard&code=consent-code&state=state-2",
      ),
    ).toBe(
      "https://auth.hsfz.live/api/auth/oauth2/authorize?client_id=liveboard&code=consent-code&state=state-2",
    );
    expect(
      resolveLoginCallback(
        "https://auth.hsfz.live/sign-in?utm_source=unexpected",
      ),
    ).toBeUndefined();
  });
});
