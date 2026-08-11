export const INVITATION_DURATIONS = {
  "2h": { label: "2 小时", milliseconds: 2 * 60 * 60 * 1_000 },
  "1d": { label: "1 天", milliseconds: 24 * 60 * 60 * 1_000 },
  "7d": { label: "7 天", milliseconds: 7 * 24 * 60 * 60 * 1_000 },
  "30d": { label: "30 天", milliseconds: 30 * 24 * 60 * 60 * 1_000 },
} as const;

export type InvitationDuration = keyof typeof INVITATION_DURATIONS;

export function invitationExpiry(duration: InvitationDuration, now = new Date()) {
  return new Date(now.getTime() + INVITATION_DURATIONS[duration].milliseconds);
}
