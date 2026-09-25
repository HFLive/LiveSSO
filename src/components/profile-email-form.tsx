"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type PendingRequest = { newEmail: string; expiresAt: string };

export function ProfileEmailForm({ mailEnabled, initialPending }: {
  mailEnabled: boolean;
  initialPending: PendingRequest | null;
}) {
  const router = useRouter();
  const [request, setRequest] = useState(initialPending);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const otpRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  async function submit(action: "request" | "confirm" | "cancel", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy) return;
    const form = event?.currentTarget;
    const values = form ? Object.fromEntries(new FormData(form)) : {};
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/auth/hflive/profile/email/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 429 ? "操作过于频繁，请稍后重试。" : data.message || "操作失败，请稍后重试。");
      form?.reset();
      if (action === "request") {
        setRequest({ newEmail: data.newEmail, expiresAt: data.expiresAt });
        setMessage("验证码已发送，请查看新邮箱。重新发送需要先取消本次更改。");
        requestAnimationFrame(() => otpRef.current?.focus());
      } else {
        setRequest(null);
        setMessage(action === "confirm" ? "邮箱已更新，可使用新邮箱登录。" : "已取消更改，原邮箱保持不变。");
        router.refresh();
        requestAnimationFrame(() => emailRef.current?.focus());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络异常，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel email-change-panel" aria-labelledby="email-change-heading">
    <div className="section-heading"><div><p className="eyebrow">账号安全</p><h2 id="email-change-heading">更改邮箱</h2></div></div>
    <p className="fine-print">输入当前密码，并验证新邮箱。完成前原邮箱仍然有效，完成后我们会向旧邮箱发送安全提醒。</p>
    {!mailEnabled ? <p className="form-error" role="alert">当前实例未启用邮件，暂时无法更改邮箱。</p> : request ?
      <form className="email-change-form" onSubmit={(event) => submit("confirm", event)}>
        <p className="fine-print">验证码已发送至 <strong>{request.newEmail}</strong>，有效期 10 分钟（{new Date(request.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" })} 北京时间到期）。</p>
        <label htmlFor="email-change-otp">新邮箱验证码</label>
        <input id="email-change-otp" ref={otpRef} name="otp" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required disabled={busy} />
        <div className="email-change-actions"><button className="primary-button" disabled={busy} type="submit">{busy ? "处理中…" : "确认更改"}</button><button className="secondary-button" disabled={busy} onClick={() => submit("cancel")} type="button">取消更改</button></div>
      </form> :
      <form className="email-change-form" onSubmit={(event) => submit("request", event)}>
        <label htmlFor="email-change-address">新邮箱</label>
        <input id="email-change-address" ref={emailRef} type="email" name="newEmail" autoComplete="email" maxLength={254} required disabled={busy} />
        <label htmlFor="email-change-password">当前密码</label>
        <input id="email-change-password" type="password" name="password" autoComplete="current-password" maxLength={128} required disabled={busy} />
        <button className="primary-button" disabled={busy} type="submit">{busy ? "发送中…" : "发送验证码"}</button>
      </form>}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {message ? <p className="form-success" role="status">{message}</p> : null}
  </section>;
}
