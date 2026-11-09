"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminUsernameForm } from "@/components/admin-username-form";
import { AdminIdentityDetailsForm } from "@/components/admin-identity-details-form";
import { AdminError } from "@/components/admin-feedback";
import { ConfirmAction } from "@/components/confirm-action";

type Member = { id: string; name: string; username: string | null; identityLabel: string | null; realName: string | null; platformRole: string; accountStatus: "ACTIVE" | "DISABLED" };
export function AdminMemberDetails({ initialUser, isSelf }: { initialUser: Member; isSelf: boolean }) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  async function changeStatus() {
    setPending(true); setError(undefined); setNotice(undefined);
    const accountStatus = user.accountStatus === "ACTIVE" ? "DISABLED" : "ACTIVE";
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountStatus }) });
      if (!response.ok) { setError("账号状态更新失败，请重试。管理员不能停用自己。"); return; }
      setUser((current) => ({ ...current, accountStatus }));
      setNotice(accountStatus === "ACTIVE" ? "账号已恢复。" : "账号已停用。");
      setConfirming(false);
      router.refresh();
    } catch { setError("无法连接管理服务，请检查网络后重试。"); }
    finally { setPending(false); }
  }
  return <div className="admin-member-details">
    <section className="admin-detail-row"><div><h2>登录用户名</h2><p className="admin-copy">用于登录 HFLive 账号。</p></div><AdminUsernameForm userId={user.id} username={user.username} onUpdated={(username) => { setUser((current) => ({ ...current, username })); router.refresh(); }} /></section>
    <section className="admin-detail-row"><div><h2>身份资料</h2><p className="admin-copy">由管理员维护的标签和真名。</p></div><AdminIdentityDetailsForm userId={user.id} identityLabel={user.identityLabel} realName={user.realName} onUpdated={(details) => { setUser((current) => ({ ...current, ...details })); router.refresh(); }} /></section>
    <section className="admin-detail-row"><div><h2>账号状态</h2><p className="admin-copy">{user.platformRole === "ADMIN" ? "平台管理员" : "组织成员"}</p></div><div>
      <span className={user.accountStatus === "ACTIVE" ? "badge" : "badge danger"}>{user.accountStatus === "ACTIVE" ? "正常" : "已停用"}</span>
      <p className="field-help">{isSelf ? "这是你当前使用的账号，不能停用。" : "停用后无法继续登录，当前平台会话会被撤销。"}</p>
      <button className={user.accountStatus === "ACTIVE" ? "danger-button" : "secondary-button"} disabled={pending || isSelf} onClick={() => { setError(undefined); if (user.accountStatus === "ACTIVE") setConfirming(true); else void changeStatus(); }}>{pending ? "更新中…" : user.accountStatus === "ACTIVE" ? "停用账号" : "恢复账号"}</button>
      {!confirming ? <AdminError message={error} /> : null}{notice ? <p className="form-success" role="status">{notice}</p> : null}
    </div></section>
    <ConfirmAction open={confirming} title={`停用“${user.name}”？`} description="此成员将无法登录，当前 HFLive Auth 会话会被撤销。恢复账号后，成员需要重新登录。" label="确认停用账号" busy={pending} error={error} onCancel={() => { setConfirming(false); setError(undefined); }} onConfirm={() => void changeStatus()} />
  </div>;
}
