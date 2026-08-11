"use client";
import { useEffect, useState, type FormEvent } from "react";
export function InvitationAdminForm() {
  const [message, setMessage] = useState<string>(); const [error, setError] = useState<string>(); const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(undefined), 5_000);
    return () => window.clearTimeout(timeout);
  }, [message]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage(undefined); setError(undefined);
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/invitations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: data.get("email"), username: data.get("username") }) });
    setPending(false);
    if (!response.ok) return setError("无法发送邀请。请确认管理员权限、邮件配置，以及邮箱或用户名是否已被使用或预留。");
    event.currentTarget.reset(); setMessage("邀请已发送，有效期 7 天。");
  }
  return <form onSubmit={submit}>{message ? <div className="top-toast" role="status" aria-live="polite"><span>{message}</span><button type="button" aria-label="关闭提示" onClick={() => setMessage(undefined)}>×</button></div> : null}<div className="field"><label htmlFor="email">成员邮箱</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
    <div className="field"><label htmlFor="username">指定用户名</label><input id="username" name="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" autoCapitalize="none" autoComplete="off" required /><p className="field-help">3–32 位，只能使用英文字母、数字和下划线。受邀者不能修改。</p></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="primary-button" disabled={pending}>{pending ? "正在发送…" : "发送邀请"}</button></form>;
}
