import { describe, expect, it } from "vitest";
import { INVITATION_DURATIONS, invitationExpiry } from "./invitation-duration";

describe("invitation duration", () => {
  it.each([
    ["2h", 2],
    ["1d", 24],
    ["7d", 168],
    ["30d", 720],
  ] as const)("maps %s to %i hours", (duration, hours) => {
    const now = new Date("2026-08-11T00:00:00.000Z");
    expect(invitationExpiry(duration, now).getTime() - now.getTime()).toBe(
      hours * 60 * 60 * 1_000,
    );
    expect(INVITATION_DURATIONS[duration].label).toBeTruthy();
  });
});
