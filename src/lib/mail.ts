import nodemailer from "nodemailer";
import { getServerEnv } from "@/lib/env";

export type TransactionalMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export function isMailEnabled() {
  return getServerEnv().MAIL_ENABLED;
}

export async function sendTransactionalMail(message: TransactionalMessage) {
  const env = getServerEnv();
  if (!env.MAIL_ENABLED) throw new Error("Transactional email is disabled.");

  if (env.MAIL_TRANSPORT === "http") {
    const response = await fetch(env.MAIL_API_URL!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.MAIL_API_TOKEN ? { authorization: `Bearer ${env.MAIL_API_TOKEN}` } : {}),
      },
      body: JSON.stringify({ from: env.MAIL_FROM, ...message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Mail provider returned HTTP ${response.status}.`);
    return;
  }

  const transport = nodemailer.createTransport({
    host: env.MAIL_SMTP_HOST,
    port: env.MAIL_SMTP_PORT,
    secure: env.MAIL_SMTP_SECURE,
    ...(env.MAIL_SMTP_USER
      ? { auth: { user: env.MAIL_SMTP_USER, pass: env.MAIL_SMTP_PASSWORD ?? "" } }
      : {}),
  });
  await transport.sendMail({ from: env.MAIL_FROM, ...message });
}

export async function sendSecurityNotice(to: string, summary: string) {
  await sendTransactionalMail({
    to,
    subject: "HFLive Auth 安全提醒",
    text: `${summary}\n\n如果这不是你的操作，请立即联系 HFLive Auth 管理员并重置密码。`,
  });
}
