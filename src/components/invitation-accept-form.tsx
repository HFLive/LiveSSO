"use client";

import { useState, type FormEvent } from "react";

export function InvitationAcceptForm({ token, assignedUsername }: { token: string; assignedUsername?: string }) {
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, username: assignedUsername ?? data.get("username"), name: data.get("name"), password: data.get("password") }),
    });
    setPending(false);
    if (!response.ok) return setError("邀请链接无效、已过期，或账号信息已被使用。请联系管理员重新邀请。");
    setDone(true);
  }

  if (done) return <p className="form-success" role="status">账号已创建。现在可以前往 <a href="/sign-in">登录</a>。</p>;
  return (
    <form onSubmit={submit}>
      <div className="field"><label htmlFor="name">显示名</label><input id="name" name="name" maxLength={80} required /></div>
      <div className="field"><label htmlFor="username">用户名</label>{assignedUsername ? <><input id="username" value={assignedUsername} readOnly aria-describedby="username-help" /><p className="field-help" id="username-help">此用户名由管理员指定。</p></> : <input id="username" name="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" autoCapitalize="none" required />}</div>
      <div className="field"><label htmlFor="password">设置密码</label><input id="password" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={pending}>{pending ? "正在创建…" : "创建账号"}</button>
    </form>
  );
}
