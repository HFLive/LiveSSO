"use client";
import { useState, type FormEvent } from "react";

export function AdminUsernameForm({ userId, username, onUpdated }: { userId: string; username: string | null; onUpdated: (username: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("username") ?? "").trim();
    setPending(true); setError(undefined); setSaved(false);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: value }) });
      const body = await response.json();
      if (!response.ok) {
        const messages: Record<string, string> = { USERNAME_TAKEN: "该用户名已被使用或被有效邀请预留。", INVALID_REQUEST: "请输入 3–32 位字母、数字或下划线。", RETRY_UPDATE: "账号刚刚发生变化，请重试。", FORBIDDEN: "需要有效的管理员权限。", UNAUTHORIZED: "登录已过期，请重新登录。", USER_NOT_FOUND: "该用户已不存在，请刷新页面。" };
        setError(messages[body.error] ?? "用户名修改失败，请重试。");
        return;
      }
      onUpdated(body.username); setEditing(false); setSaved(true);
    } catch { setError("网络异常，请重试。"); }
    finally { setPending(false); }
  }
  return <div className="username-editor">
    <code>{username ?? "未设置"}</code>
    {!editing ? <button type="button" onClick={() => { setEditing(true); setSaved(false); setError(undefined); }}>修改用户名</button> : <form onSubmit={submit}>
      <label htmlFor={`username-${userId}`}>新登录用户名</label>
      <input id={`username-${userId}`} name="username" defaultValue={username ?? ""} required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]{3,32}" autoCapitalize="none" autoComplete="off" spellCheck={false} aria-describedby={`username-help-${userId}`} disabled={pending} autoFocus />
      <small id={`username-help-${userId}`}>3–32 位字母、数字或下划线，不区分大小写。保存后请使用新用户名登录，邮箱登录仍可用。</small>
      <div className="compact-actions"><button disabled={pending}>{pending ? "保存中…" : "保存用户名"}</button><button type="button" disabled={pending} onClick={() => { setEditing(false); setError(undefined); }}>取消</button></div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form>}
    {saved ? <small role="status">用户名已保存</small> : null}
  </div>;
}
