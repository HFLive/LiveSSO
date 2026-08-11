import { describe, expect, it } from "vitest";
import {
  normalizeProfileName,
  ProfileNameError,
} from "@/lib/security/profile-service";

describe("normalizeProfileName", () => {
  it("trims and normalizes whitespace", () => {
    expect(normalizeProfileName("  HFLive   成员  ")).toBe("HFLive 成员");
  });

  it("rejects empty, oversized, and control-character names", () => {
    expect(() => normalizeProfileName("   ")).toThrow(ProfileNameError);
    expect(() => normalizeProfileName("a".repeat(81))).toThrow(ProfileNameError);
    expect(() => normalizeProfileName("name\u0000value")).toThrow(ProfileNameError);
  });
});
