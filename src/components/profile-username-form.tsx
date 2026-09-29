"use client";

import { useState, type FormEvent } from "react";
import { ProfileEditDialog } from "@/components/profile-edit-dialog";

const errors: Record<string, string> = {
  INVALID_USERNAME: "用户名须为 3–32 位英文字母、数字或下划线。",
  USERNAME_TAKEN: "这个用户名已被使用，请换一个。",
  INVALID_PASSWORD: "当前密码不正确。",
  RETRY_UPDATE: "更新冲突，请重试。",
  FORBIDDEN: "当前账号不能修改用户名。",
  UNAUTHORIZED: "登录已失效，请重新登录。",
  RATE_LIMITED: "尝试过于频繁，请 10 分钟后重试。",
};

export function ProfileUsernameForm({ username, onUpdated, onNotice }: { username: string | null; onUpdated: (username: string) => void; onNotice: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(username ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(draft.trim())) {
      setError(errors.INVALID_USERNAME);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/profile/username", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: draft, password }),
      });
      const data = await response.json() as { username?: string; error?: string };
      if (!response.ok || !data.username) throw new Error(errors[data.error ?? ""] ?? "用户名更新失败，请稍后重试。");
      onUpdated(data.username);
      setDraft(data.username);
      setPassword("");
      setOpen(false);
      onNotice(data.username.toLowerCase() === username?.toLowerCase() ? "用户名没有变化。" : "用户名已更新，可用新用户名登录。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "用户名更新失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button
      className="profile-inline-action"
      type="button"
      onClick={() => {
        setDraft(username ?? "");
        setPassword("");
        setError("");
        setOpen(true);
      }}
    >更改</button>
    <ProfileEditDialog open={open} title="更改登录用户名" description={`当前用户名：@${username ?? "未设置"}`} busy={busy} onClose={() => setOpen(false)}>
      <form className="profile-dialog-form" onSubmit={submit}>
        <p className="fine-print">用户名由 3–32 位英文字母、数字或下划线组成。更改后请用新用户名登录。</p>
        <label htmlFor="profile-new-username">新用户名</label>
        <input id="profile-new-username" data-profile-dialog-focus autoComplete="username" maxLength={32} required value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} />
        <label htmlFor="profile-username-password">当前密码</label>
        <input id="profile-username-password" type="password" autoComplete="current-password" maxLength={128} required value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="profile-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => setOpen(false)}>取消</button>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "保存中…" : "保存用户名"}</button>
        </div>
      </form>
    </ProfileEditDialog>
  </>;
}
