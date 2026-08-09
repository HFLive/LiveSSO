const DISPATCH_PATH = "/api/internal/outbox/dispatch";

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
    throw new Error(`Outbox dispatch failed with HTTP ${response.status}.`);
  }
}

const worker = {
  async scheduled(_controller, env) {
    await dispatchOutbox(env);
  },
};

export default worker;
