import { describe, expect, it } from "vitest";
import { resolveStaticAssetConfig } from "./static-assets-config";

describe("static asset provider configuration", () => {
  it("uses Vercel by default", () => {
    expect(resolveStaticAssetConfig({})).toEqual({
      provider: "vercel",
      assetPrefix: undefined,
    });
  });

  it("resolves a validated EdgeOne configuration", () => {
    expect(
      resolveStaticAssetConfig({
        STATIC_ASSET_PROVIDER: "edgeone",
        EDGEONE_ASSET_ORIGIN: "https://static-auth.hsfz.live",
        EDGEONE_PROJECT_NAME: "hflive-auth-static-eo",
      }),
    ).toEqual({
      provider: "edgeone",
      assetPrefix: "https://static-auth.hsfz.live",
      projectName: "hflive-auth-static-eo",
    });
  });

  it("rejects unsafe origins and unsupported providers", () => {
    expect(() =>
      resolveStaticAssetConfig({
        STATIC_ASSET_PROVIDER: "edgeone",
        EDGEONE_ASSET_ORIGIN: "http://static-auth.hsfz.live/path",
      }),
    ).toThrow("EDGEONE_ASSET_ORIGIN must be an HTTPS origin");

    expect(() => resolveStaticAssetConfig({ STATIC_ASSET_PROVIDER: "cloudflare" })).toThrow(
      "STATIC_ASSET_PROVIDER must be vercel or edgeone.",
    );
  });
});
