import { describe, expect, it } from "vitest";
import { assessLoginRisk } from "./security/login-risk";

describe("Phase 3 login risk paths", () => {
  it.each([
    { changes: {}, reasons: [] },
    { changes: { ipChanged: true, recentFailures: 2 }, reasons: [] },
    { changes: { recentSuccesses: 5 }, reasons: [] },
    { changes: { recentFailures: 4 }, reasons: [] },
    { changes: { trusted: false }, reasons: ["new_device"] },
    { changes: { recentFailures: 5 }, reasons: ["repeated_failure"] },
    { changes: { userAgentChanged: true }, reasons: ["user_agent_change"] },
    { changes: { ipChanged: true, recentSuccesses: 5 }, reasons: ["ip_change", "login_frequency"] },
  ])("assesses a login with $changes", ({ changes, reasons }) => {
    expect(assessLoginRisk({
      trusted: true,
      recentFailures: 0,
      recentSuccesses: 0,
      ipChanged: false,
      userAgentChanged: false,
      ...changes,
    })).toEqual(reasons);
  });
});
