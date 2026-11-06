export function assessLoginRisk(input: {
  trusted: boolean;
  recentFailures: number;
  recentSuccesses: number;
  ipChanged: boolean;
  userAgentChanged: boolean;
}) {
  const reasons: string[] = [];
  if (!input.trusted) reasons.push("new_device");
  if (input.recentFailures >= 5) reasons.push("repeated_failure");
  if (input.trusted && input.ipChanged && input.recentSuccesses >= 5) {
    reasons.push("ip_change", "login_frequency");
  }
  if (input.trusted && input.userAgentChanged) reasons.push("user_agent_change");
  return reasons;
}
