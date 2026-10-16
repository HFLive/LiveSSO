"use client";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminCredentialNotice, AdminError, type AdminCredential } from "@/components/admin-feedback";

type Client = { clientId: string; disabled: boolean | null; scopes: string[]; redirectUris: string[]; webhooks: Array<{ endpointUrl: string; eventTypes: string[] }> };
type WebhookStatus = { counts: { pending: number; processing: number; deadLetter: number; delivered: number }; recentFailures: Array<{ lastErrorCode: string | null }> };
export type ClientSettingsTab = "login" | "events" | "access";
type Action = "update_configuration" | "update_webhook" | "rotate_webhook_secret" | "disable" | "enable" | "rotate_secret";

const errors: Record<Action, string> = {
  update_configuration: "配置更新失败，请检查回调地址与 scopes。登录应用至少需要一个精确回调地址。",
  update_webhook: "事件设置保存失败，请检查接收地址与事件类型。",
  rotate_webhook_secret: "签名密钥轮换失败，请重试。",
  disable: "停用应用失败，请重试。", enable: "启用应用失败，请重试。", rotate_secret: "应用密钥轮换失败，请重试。",
};

export function AdminClientSettings({ client, tab, initialWebhookStatus }: { client: Client; tab: ClientSettingsTab; initialWebhookStatus: WebhookStatus | null }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [credential, setCredential] = useState<AdminCredential>();
  const [refreshedStatus, setStatus] = useState<WebhookStatus>();
  const status = refreshedStatus ?? initialWebhookStatus;
  const busy = pending || refreshing;
  const webhook = client.webhooks[0];
  async function action(action: Action, data: Record<string, string | string[]> = {}) {
    setPending(true); setError(undefined); setNotice(undefined);
    try {
      const response = await fetch(`/api/admin/clients/${encodeURIComponent(client.clientId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...data }) });
      if (!response.ok) { setError(errors[action]); return; }
      const result = await response.json() as { clientSecret?: string; webhookSecret?: string };
      setStatus(undefined);
      if (result.clientSecret || result.webhookSecret) setCredential({ clientId: client.clientId, ...result });
      else setNotice(action === "disable" ? "应用已停用。" : action === "enable" ? "应用已启用。" : "设置已保存。");
      startTransition(() => router.refresh());
    } catch { setError("无法连接管理服务，请检查网络后重试。"); }
    finally { setPending(false); }
  }
  function saveLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void action("update_configuration", { redirectUris: String(data.get("redirectUris") ?? "").split(/\s+/).filter(Boolean), scopes: String(data.get("scopes") ?? "").split(/\s+/).filter(Boolean) });
  }
  function saveWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const endpointUrl = String(data.get("endpointUrl") ?? "").trim();
    const eventTypes = String(data.get("eventTypes") ?? "").split(/\s+/).filter(Boolean);
    void action("update_webhook", { ...(endpointUrl ? { endpointUrl } : {}), ...(eventTypes.length ? { eventTypes } : {}) });
  }
  async function refreshStatus() {
    setPending(true); setError(undefined);
    try {
      const response = await fetch(`/api/admin/clients/${encodeURIComponent(client.clientId)}/webhook-status`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      setStatus(await response.json() as WebhookStatus);
    } catch { setError("投递状态刷新失败，请重试。"); }
    finally { setPending(false); }
  }
  if (credential) return <AdminCredentialNotice credential={credential} onDone={() => setCredential(undefined)} />;
  return <div className="admin-settings">
    <AdminError message={error} />{notice ? <p className="form-success" role="status">{notice}</p> : null}
    {tab === "login" ? <section className="client-editor">
      <h2>登录设置</h2>
      <form onSubmit={saveLogin}>
        <label>登录回调地址（每行一个）<textarea name="redirectUris" rows={4} defaultValue={client.redirectUris.join("\n")} disabled={busy} /></label>
        <label>Scopes（空格分隔）<textarea name="scopes" rows={2} defaultValue={client.scopes.join(" ")} required disabled={busy} /></label>
        <div className="client-save-row"><button disabled={busy}>{busy ? "保存中…" : "保存设置"}</button><small>保存会撤销旧 token 和授权。</small></div>
      </form>
    </section> : tab === "events" ? <section className="client-editor">
      <h2>事件通知</h2><p className="webhook-note">{webhook ? "使用稳定的 HTTPS 地址接收事件。" : "添加接收地址后会生成一次性显示的签名密钥。"}</p>
      <form onSubmit={saveWebhook}>
        <label>接收地址<input name="endpointUrl" type="url" defaultValue={webhook?.endpointUrl ?? ""} placeholder="https://app.example/api/internal/hflive/events" disabled={busy} /></label>
        <label>事件类型（空格分隔）<input name="eventTypes" defaultValue={webhook?.eventTypes.join(" ") ?? ""} placeholder="user.status.changed user.profile.changed" disabled={busy} /></label>
        <button disabled={busy}>{busy ? "保存中…" : "保存事件设置"}</button>
      </form>
      {webhook ? <div className="webhook-actions"><button disabled={busy} onClick={() => void action("rotate_webhook_secret")}>轮换签名密钥</button><button disabled={busy} onClick={() => void refreshStatus()}>刷新投递状态</button></div> : null}
      {status ? <p className="webhook-health">事件投递：待处理 {status.counts.pending + status.counts.processing} · 成功 {status.counts.delivered}{status.counts.deadLetter > 0 ? <> · <span className="text-danger">需处理 {status.counts.deadLetter}</span></> : null}{status.recentFailures[0] ? <> · 最近失败 <span className="text-danger">{status.recentFailures[0].lastErrorCode ?? "DELIVERY_FAILED"}</span></> : null}</p> : null}
    </section> : <section className="client-editor">
      <h2>凭据与状态</h2>
      <div className="admin-setting-row"><div><h3>应用状态 <span className={client.disabled ? "badge danger" : "badge"}>{client.disabled ? "已停用" : "已启用"}</span></h3><p className="field-help">停用将阻止应用继续登录，并撤销已有 token。</p></div><button disabled={busy} onClick={() => void action(client.disabled ? "enable" : "disable")}>{client.disabled ? "启用应用" : "停用应用"}</button></div>
      <div className="admin-setting-row"><div><h3>应用密钥</h3><p className="field-help">轮换会撤销已有 token。新密钥仅显示一次，请及时更新应用配置。</p></div><button disabled={busy} onClick={() => void action("rotate_secret")}>轮换密钥</button></div>
    </section>}
  </div>;
}
