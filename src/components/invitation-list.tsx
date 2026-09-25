"use client";
import { useEffect, useState } from "react";

type Invitation = {
  id: string; email: string; username: string | null;
  status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  createdAt: string | Date; expiresAt: string | Date;
  acceptedAt: string | Date | null; revokedAt: string | Date | null;
};
const labels = { PENDING: "待接受", ACCEPTED: "已接受", REVOKED: "已撤回", EXPIRED: "已过期" };
const formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

export function InvitationList({ initialInvitations }: { initialInvitations: Invitation[] }) {
  const [invitations, setInvitations] = useState(initialInvitations);
  const [confirming, setConfirming] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  async function refresh() {
    try {
      const response = await fetch("/api/invitations", { cache: "no-store" });
      if (!response.ok) throw new Error("LIST_FAILED");
      const result = await response.json() as { invitations: Invitation[] };
      setInvitations(result.invitations);
    } catch { setError("邀请列表更新失败，请刷新页面重试。"); }
  }
  useEffect(() => {
    const handleCreated = () => { setError(undefined); void refresh(); };
    window.addEventListener("hflive:invitation-created", handleCreated);
    return () => window.removeEventListener("hflive:invitation-created", handleCreated);
  }, []);
  async function revoke(id: string) {
    setPending(id); setError(undefined); setMessage(undefined);
    try {
      const response = await fetch(`/api/invitations/${encodeURIComponent(id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(result.error === "INVITATION_NOT_PENDING" ? "该邀请已接受、撤回或过期，列表已更新。" : result.error === "RETRY_UPDATE" ? "邀请状态刚刚变化，请重试。" : "撤回失败，请稍后重试。");
        await refresh();
        return;
      }
      setInvitations((current) => current.map((item) => item.id === id ? { ...item, status: "REVOKED", revokedAt: new Date() } : item));
      setMessage("邀请已撤回，邮箱和用户名现在可以重新用于邀请或分配。");
    } catch { setError("无法连接邀请服务，请检查网络后重试。"); }
    finally { setPending(undefined); setConfirming(undefined); }
  }
  return <section className="panel invitation-list-panel" aria-labelledby="invitation-list-title">
    <div className="invitation-list-heading"><div><h2 id="invitation-list-title">邀请记录</h2><p className="admin-copy">显示全部有效邀请及最近 30 条历史记录。</p></div><button type="button" className="secondary-button" onClick={() => { setError(undefined); void refresh(); }}>刷新</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {message ? <p className="invitation-success" role="status">{message}</p> : null}
    {invitations.length === 0 ? <p className="admin-copy invitation-empty">暂无邀请。</p> : <div className="invitation-records">{invitations.map((item) => {
      const active = item.status === "PENDING";
      const status = item.status;
      return <article className="invitation-record" key={item.id}>
        <div className="invitation-record-main"><strong>{item.email}</strong><span className={status === "PENDING" ? "badge" : status === "REVOKED" ? "badge danger" : "badge muted"}>{labels[status]}</span></div>
        <div className="invitation-record-meta"><span>用户名 <code>{item.username ?? "未指定"}</code></span><span>发送 {formatter.format(new Date(item.createdAt))}</span><span>{status === "PENDING" ? "到期" : status === "ACCEPTED" ? "接受" : status === "REVOKED" ? "撤回" : "到期"} {formatter.format(new Date(status === "ACCEPTED" ? item.acceptedAt ?? item.expiresAt : status === "REVOKED" ? item.revokedAt ?? item.expiresAt : item.expiresAt))}</span></div>
        {active ? <div className="invitation-record-actions">{confirming === item.id ? <><span>撤回后链接立即失效，用户名和邮箱释放。</span><button type="button" onClick={() => void revoke(item.id)} disabled={pending === item.id}>{pending === item.id ? "撤回中…" : "确认撤回"}</button><button type="button" onClick={() => setConfirming(undefined)} disabled={pending === item.id}>取消</button></> : <button type="button" onClick={() => setConfirming(item.id)}>撤回邀请</button>}</div> : null}
      </article>;
    })}</div>}
  </section>;
}
