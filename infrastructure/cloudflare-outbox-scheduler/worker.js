const DISPATCH_PATH = "/api/internal/outbox/dispatch";
const PENDING_KEY = "pending";

export async function shouldDispatch(env, now = new Date()) {
  if (!env.OUTBOX_PENDING) return { reason: "no-kv" };
  const pending = await env.OUTBOX_PENDING.get(PENDING_KEY);
  if (pending) return { reason: "flag" };
  if (now.getUTCMinutes() === 7 && now.getUTCHours() % 6 === 0) {
    return { reason: "safety" };
  }
  return null;
}

export async function markPending(env) {
  if (!env.OUTBOX_PENDING) {
    throw new Error("OUTBOX_PENDING KV is not bound.");
  }
  await env.OUTBOX_PENDING.put(PENDING_KEY, "1");
}

function authorized(request, env) {
  const expected = env.OUTBOX_WORKER_SECRET ?? "";
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.replace(/^Bearer\s+/i, "");
  if (!expected || supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}

export async function dispatchOutbox(env) {
  if (!env.AUTH_ORIGIN || !env.OUTBOX_WORKER_SECRET) {
    throw new Error("AUTH_ORIGIN and OUTBOX_WORKER_SECRET are required.");
  }

  const target = new URL(DISPATCH_PATH, env.AUTH_ORIGIN);
  if (target.protocol !== "https:") {
    throw new Error("AUTH_ORIGIN must use HTTPS.");
  }

  const response = await fetch(target, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OUTBOX_WORKER_SECRET}`,
      "user-agent": "hflive-auth-outbox-scheduler/1.0",
    },
    redirect: "manual",
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Outbox dispatch failed with HTTP ${response.status}.`);
  }

  const payload = await response.json().catch(() => null);
  const claimed =
    payload && typeof payload.claimed === "number" ? payload.claimed : null;
  return { claimed };
}

export async function runScheduled(env, now = new Date()) {
  const decision = await shouldDispatch(env, now);
  if (!decision) return { skipped: true, claimed: 0 };
  const result = await dispatchOutbox(env);
  if (env.OUTBOX_PENDING && result.claimed === 0) {
    await env.OUTBOX_PENDING.delete(PENDING_KEY);
  }
  return { skipped: false, claimed: result.claimed };
}

const worker = {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (!authorized(request, env)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const path = new URL(request.url).pathname;
    if (path !== "/wake" && path !== "/") {
      return new Response("Not Found", { status: 404 });
    }
    await markPending(env);
    return new Response(null, { status: 204 });
  },
  async scheduled(_controller, env) {
    await runScheduled(env);
  },
};

export default worker;
