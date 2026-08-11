import { describe, expect, it } from "vitest";
import { normalizeProfileReturnTo, profileReturnClientLabel } from "./profile-return";

describe("normalizeProfileReturnTo", () => {
  const origins = ["https://board.hsfz.live"];

  it("accepts a page on an approved application origin", () => {
    expect(normalizeProfileReturnTo("https://board.hsfz.live/app/profile?tab=identity#private", origins)).toBe(
      "https://board.hsfz.live/app/profile?tab=identity",
    );
  });

  it("rejects unapproved, malformed and credential-bearing targets", () => {
    expect(normalizeProfileReturnTo("https://evil.example/", origins)).toBeUndefined();
    expect(normalizeProfileReturnTo("not-a-url", origins)).toBeUndefined();
    expect(normalizeProfileReturnTo("https://user:pass@board.hsfz.live/app/profile", origins)).toBeUndefined();
  });
});

describe("profileReturnClientLabel", () => {
  it("uses the public product name for LiveBoard", () => {
    expect(profileReturnClientLabel("LiveBoard Production", "board.hsfz.live")).toBe("LiveBoard");
  });

  it("uses a cleaned client name or hostname for other approved applications", () => {
    expect(profileReturnClientLabel("Example Production", "example.com")).toBe("Example");
    expect(profileReturnClientLabel(null, "example.com")).toBe("example.com");
  });
});
