import { describe, expect, it } from "vitest";
import { resolveAuthenticatedDestination } from "./authenticated-destination";

describe("authenticated sign-in destination", () => {
  it("continues an OIDC request without showing the password form again", () => {
    const result = resolveAuthenticatedDestination(
      "https://auth.hsfz.live/sign-in?client_id=liveboard&redirect_uri=https%3A%2F%2Fboard.hsfz.live%2Fapi%2Fauth%2Fhflive%2Fcallback&response_type=code&scope=openid&state=state-1&code_challenge=challenge&code_challenge_method=S256",
    );

    expect(result).toBe(
      "/api/auth/oauth2/authorize?client_id=liveboard&redirect_uri=https%3A%2F%2Fboard.hsfz.live%2Fapi%2Fauth%2Fhflive%2Fcallback&response_type=code&scope=openid&state=state-1&code_challenge=challenge&code_challenge_method=S256",
    );
  });

  it("allows same-origin callbacks and rejects external redirects", () => {
    expect(
      resolveAuthenticatedDestination(
        "https://auth.hsfz.live/sign-in?callbackURL=%2Fprofile",
      ),
    ).toBe("/profile");
    expect(
      resolveAuthenticatedDestination(
        "https://auth.hsfz.live/sign-in?callbackURL=https%3A%2F%2Fevil.example%2Fsteal",
      ),
    ).toBe("/profile");
  });

  it("sends a direct sign-in visit to profile management", () => {
    expect(
      resolveAuthenticatedDestination("https://auth.hsfz.live/sign-in"),
    ).toBe("/profile");
  });
});
