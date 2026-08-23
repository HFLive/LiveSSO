import { getServerEnv } from "@/lib/env";

const WAKE_TIMEOUT_MS = 2_000;

/**
 * Tell the Cloudflare scheduler there is outbox work. The minute cron
 * otherwise skips Neon when this flag is absent, so idle compute can sleep.
 * Failures are swallowed: the 6-hour safety dispatch still drains leftovers.
 */
export async function markOutboxPending(
  input: { fetchImpl?: typeof fetch } = {},
) {
  const env = getServerEnv();
  const wakeUrl = env.OUTBOX_WAKE_URL;
  const secret = env.OUTBOX_WORKER_SECRET ?? env.CRON_SECRET;
  if (!wakeUrl || !secret) return;

  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(wakeUrl, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${secret}`,
        "user-agent": "hflive-auth/outbox-wake",
      },
    });
    await response.body?.cancel();
  } catch {
    // Best-effort wake. Pending rows remain in PostgreSQL.
  }
}
