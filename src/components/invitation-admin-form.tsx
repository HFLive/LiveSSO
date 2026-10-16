"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminError } from "@/components/admin-feedback";
import { INVITATION_DURATIONS, type InvitationDuration } from "@/lib/invitation-duration";
import { invitationErrorMessage } from "@/lib/invitation-error";
export function InvitationAdminForm() {
  const router = useRouter();
  const completeRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState<string>(); const [error, setError] = useState<string>(); const [pending, setPending] = useState(false);
  useEffect(() => { if (message) completeRef.current?.focus(); }, [message]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage(undefined); setError(undefined);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch("/api/invitations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: data.get("email"), username: data.get("username"), identityLabel: data.get("identityLabel"), realName: data.get("realName"), expiresIn: data.get("expiresIn") }) });
      const result = await response.json().catch(() => ({})) as { error?: string; expiresIn?: InvitationDuration };
      if (!response.ok) {
        setError(invitationErrorMessage(result.error));
        return;
      }
      form.reset(); setMessage(`邀请已发送，有效期 ${result.expiresIn ? INVITATION_DURATIONS[result.expiresIn].label : "已设置"}。`);
      router.refresh();
    } catch {
      setError("无法连接邀请服务，请检查网络后重试。");
    } finally {
      setPending(false);
    }
  }
  if (message) return <div className="invitation-complete" role="status" tabIndex={-1} ref={completeRef}><h2>邀请已发送</h2><p className="admin-copy">{message}</p><div className="button-row"><button className="secondary-button" onClick={() => setMessage(undefined)}>继续邀请</button><Link className="primary-button" href="/admin/invitations">查看邀请记录</Link></div></div>;
  return <form onSubmit={submit}><div className="field"><label htmlFor="email">成员邮箱</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
    <div className="field"><label htmlFor="username">指定用户名（可选）</label><input id="username" name="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" autoCapitalize="none" autoComplete="off" /><p className="field-help">留空由受邀者自行选择；填写时为 3–32 位英文字母、数字或下划线，受邀者不能修改。</p></div>
    <details className="invitation-identity-option"><summary>指定身份资料（可选）</summary>
      <p className="field-help">资料在接受邀请后写入账号，仅管理员可以修改。</p>
      <div className="field"><label htmlFor="identityLabel">身份标签</label><input id="identityLabel" name="identityLabel" maxLength={40} placeholder="例如：教师" /></div>
      <div className="field"><label htmlFor="realName">真名</label><input id="realName" name="realName" maxLength={80} autoComplete="off" placeholder="可留空" /></div>
    </details>
    <div className="field"><label htmlFor="expiresIn">链接有效期</label><select id="expiresIn" name="expiresIn" defaultValue="7d">
      {Object.entries(INVITATION_DURATIONS).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
    </select><p className="field-help">到期未注册时，邮箱和用户名会在下一次邀请时自动释放。</p></div>
    <AdminError message={error} />
    <button className="primary-button" disabled={pending}>{pending ? "正在发送…" : "发送邀请"}</button></form>;
}
