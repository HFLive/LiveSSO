"use client";

import { useState, type FormEvent } from "react";

export function InvitationAcceptForm({ token, assignedUsername, identityLabel, realName }: { token: string; assignedUsername?: string; identityLabel: string | null; realName: string | null }) {
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, username: assignedUsername ?? data.get("username"), name: data.get("name"), password: data.get("password") }),
      });
      if (!response.ok) {
        setError(assignedUsername ? "邀请链接无效、已过期，或账号信息已被使用。请联系管理员重新邀请。" : "无法创建账号。请尝试其他用户名，并确认邀请链接仍然有效。");
        return;
      }
      setDone(true);
    } catch {
      setError("无法连接邀请服务，请检查网络后重试。");
    } finally {
      setPending(false);
    }
  }

  if (done) return <p className="form-success" role="status">账号已创建。现在可以前往 <a href="/sign-in">登录</a>。</p>;
  return (
    <form onSubmit={submit}>
      <div className="field"><label htmlFor="name">显示名</label><input id="name" name="name" maxLength={80} required /></div>
      <div className="field"><label htmlFor="username">用户名</label>{assignedUsername ? <><input id="username" value={assignedUsername} readOnly aria-describedby="username-help" /><p className="field-help" id="username-help">此用户名由管理员指定。</p></> : <input id="username" name="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" autoCapitalize="none" required />}</div>
      {identityLabel || realName ? <div className="field"><span>管理员指定的身份资料</span><p className="field-help">{[identityLabel, realName].filter(Boolean).join(" · ")}</p></div> : null}
      <div className="field"><label htmlFor="password">设置密码</label><input id="password" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={pending}>{pending ? "正在创建…" : "创建账号"}</button>
    </form>
  );
}
