"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ProfileEditDialog } from "@/components/profile-edit-dialog";

type PendingRequest = { newEmail: string; expiresAt: string };

export function ProfileEmailForm({ mailEnabled, initialPending, currentEmail, onNotice }: {
  mailEnabled: boolean;
  initialPending: PendingRequest | null;
  currentEmail: string;
  onNotice: (message: string) => void;
}) {
  const router = useRouter();
  const [request, setRequest] = useState(initialPending);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && request) document.getElementById("email-change-otp")?.focus();
  }, [open, request]);

  async function submit(action: "request" | "confirm" | "cancel", event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy) return;
    const form = event?.currentTarget;
    const values = form ? Object.fromEntries(new FormData(form)) : {};
    setBusy(true);
    setError("");
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
      } else {
        setRequest(null);
        setOpen(false);
        onNotice(action === "confirm" ? "邮箱已更新，可使用新邮箱登录。" : "已取消更改，原邮箱保持不变。");
        router.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络异常，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return <>
    {mailEnabled ? <button
      className="profile-inline-action"
      type="button"
      onClick={() => {
        setError("");
        setOpen(true);
      }}
    >{request ? "继续更改" : "更改"}</button> : <>
      <button className="profile-inline-action" type="button" disabled>更改</button>
      <small className="profile-email-unavailable">当前未启用邮件</small>
    </>}
    {mailEnabled ? <ProfileEditDialog open={open} title={request ? "验证新邮箱" : "更改邮箱"} description={`当前邮箱：${currentEmail}`} busy={busy} onClose={() => setOpen(false)}>
      {request ? <form className="profile-dialog-form" onSubmit={(event) => submit("confirm", event)}>
        <p className="fine-print">验证码已发送至 <strong>{request.newEmail}</strong>，有效期至 {new Date(request.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" })}（北京时间）。</p>
        <label htmlFor="email-change-otp">新邮箱验证码</label>
        <input id="email-change-otp" data-profile-dialog-focus name="otp" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required disabled={busy} />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="profile-dialog-actions">
          <button className="secondary-button" disabled={busy} onClick={() => submit("cancel")} type="button">取消更改</button>
          <button className="primary-button" disabled={busy} type="submit">{busy ? "处理中…" : "确认更改"}</button>
        </div>
      </form> : <form className="profile-dialog-form" onSubmit={(event) => submit("request", event)}>
        <p className="fine-print">验证新邮箱后才会更改登录邮箱。旧邮箱会收到安全提醒。</p>
        <label htmlFor="email-change-address">新邮箱</label>
        <input id="email-change-address" data-profile-dialog-focus type="email" name="newEmail" autoComplete="email" maxLength={254} required disabled={busy} />
        <label htmlFor="email-change-password">当前密码</label>
        <input id="email-change-password" type="password" name="password" autoComplete="current-password" maxLength={128} required disabled={busy} />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="profile-dialog-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => setOpen(false)}>取消</button>
          <button className="primary-button" disabled={busy} type="submit">{busy ? "发送中…" : "发送验证码"}</button>
        </div>
      </form>}
    </ProfileEditDialog> : null}
  </>;
}
