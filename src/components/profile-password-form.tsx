"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { ProfileEditDialog } from "@/components/profile-edit-dialog";

export function ProfilePasswordForm({ initialOpen, onNotice }: {
  initialOpen: boolean;
  onNotice: (message: string) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close() {
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (newPassword.length < 12 || newPassword.length > 128) {
      setError("新密码需要 12–128 个字符。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }

    setBusy(true);
    try {
      const { error: changeError } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (changeError) {
        const message = changeError.code === "INVALID_PASSWORD"
          ? "当前密码不正确。"
          : changeError.status === 429
            ? "尝试过于频繁，请稍后重试。"
            : changeError.status === 401 || changeError.status === 403
              ? "请重新登录后再修改密码。"
              : "密码修改失败，请稍后重试。";
        setError(message);
        return;
      }
      close();
      onNotice("密码已修改，其他 HFLive Auth 登录会话已退出。");
    } catch {
      setError("网络异常，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="profile-inline-action" type="button" onClick={() => { setError(""); setOpen(true); }}>更改</button>
    <ProfileEditDialog open={open} title="更改密码" description="修改后，其他 HFLive Auth 登录会话将退出。" busy={busy} onClose={close}>
      <form className="profile-dialog-form" onSubmit={submit}>
        <label htmlFor="profile-current-password">当前密码</label>
        <input id="profile-current-password" data-profile-dialog-focus type="password" autoComplete="current-password" maxLength={128} required disabled={busy} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        <label htmlFor="profile-new-password">新密码</label>
        <input id="profile-new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        <label htmlFor="profile-confirm-password">确认新密码</label>
        <input id="profile-confirm-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="profile-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={close}>取消</button>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "修改中…" : "修改密码"}</button>
        </div>
      </form>
    </ProfileEditDialog>
  </>;
}
