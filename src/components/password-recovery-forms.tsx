"use client";

import { useState, type FormEvent } from "react";

export function ForgotPasswordForm() {
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
    const response = await fetch("/api/auth/request-password-reset", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: data.get("email"), redirectTo: `${window.location.origin}/reset-password` }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) { setError(response.status === 429 ? "尝试过于频繁，请稍后重试。" : "暂时无法处理重置请求，请稍后重试。"); return; }
    setDone(true);
    } catch { setError("无法连接账号恢复服务，请检查网络后重试。"); }
    finally { setPending(false); }
  }
  if (done) return <><p className="form-success" role="status">请求已提交。如果该邮箱对应有效账号且邮件服务可用，请检查收件箱和垃圾邮件。暂未收到时可稍后重试或联系管理员。</p><button className="form-link text-button" type="button" onClick={() => setDone(false)}>重新填写邮箱</button></>;
  return <form onSubmit={submit}>
    <div className="field"><label htmlFor="email">账号邮箱</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="primary-button" disabled={pending}>{pending ? "正在提交…" : "发送重置邮件"}</button>
  </form>;
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
    const response = await fetch("/api/auth/reset-password", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword: data.get("password") }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return setError("重置链接无效、已过期或密码不符合要求。");
    setDone(true);
    } catch { setError("无法连接账号恢复服务，请检查网络后重试。"); }
    finally { setPending(false); }
  }
  if (done) return <p className="form-success" role="status">密码已重置，其他会话已撤销。现在可以 <a href="/sign-in">登录</a>。</p>;
  return <form onSubmit={submit}>
    <div className="field"><label htmlFor="password">新密码</label><input id="password" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="primary-button" disabled={pending}>{pending ? "正在重置…" : "重置密码"}</button>
  </form>;
}
