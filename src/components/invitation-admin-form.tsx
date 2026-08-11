"use client";
import { useEffect, useState, type FormEvent } from "react";
import { INVITATION_DURATIONS, type InvitationDuration } from "@/lib/invitation-duration";
import { invitationErrorMessage } from "@/lib/invitation-error";
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
    try {
      const response = await fetch("/api/invitations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: data.get("email"), username: data.get("username"), expiresIn: data.get("expiresIn") }) });
      const result = await response.json().catch(() => ({})) as { error?: string; expiresIn?: InvitationDuration };
      if (!response.ok) {
        setError(invitationErrorMessage(result.error));
        return;
      }
      event.currentTarget.reset(); setMessage(`邀请已发送，有效期 ${result.expiresIn ? INVITATION_DURATIONS[result.expiresIn].label : "已设置"}。`);
    } catch {
      setError("无法连接邀请服务，请检查网络后重试。");
    } finally {
      setPending(false);
    }
  }
  return <form onSubmit={submit}>{message ? <div className="top-toast" role="status" aria-live="polite"><span>{message}</span><button type="button" aria-label="关闭提示" onClick={() => setMessage(undefined)}>×</button></div> : null}<div className="field"><label htmlFor="email">成员邮箱</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
    <div className="field"><label htmlFor="username">指定用户名</label><input id="username" name="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" autoCapitalize="none" autoComplete="off" required /><p className="field-help">3–32 位，只能使用英文字母、数字和下划线。受邀者不能修改。</p></div>
    <div className="field"><label htmlFor="expiresIn">链接有效期</label><select id="expiresIn" name="expiresIn" defaultValue="7d">
      {Object.entries(INVITATION_DURATIONS).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
    </select><p className="field-help">到期未注册时，邮箱和用户名会在下一次邀请时自动释放。</p></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="primary-button" disabled={pending}>{pending ? "正在发送…" : "发送邀请"}</button></form>;
}
