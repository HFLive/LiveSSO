"use client";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminCredentialNotice, AdminError, type AdminCredential } from "@/components/admin-feedback";
import { ConfirmAction } from "@/components/confirm-action";
import { ClientScopeFields } from "@/components/client-scope-fields";
import { useLeaveGuard } from "@/lib/use-leave-guard";

type Client = { clientId: string; name: string | null; disabled: boolean | null; scopes: string[]; redirectUris: string[]; webhooks: Array<{ endpointUrl: string; eventTypes: string[] }> };
type WebhookStatus = { counts: { pending: number; processing: number; deadLetter: number; delivered: number }; recentFailures: Array<{ lastErrorCode: string | null }> };
export type ClientSettingsTab = "login" | "events" | "access";
type Action = "update_configuration" | "update_webhook" | "rotate_webhook_secret" | "disable" | "enable" | "rotate_secret";

const errors: Record<Action, string> = {
  update_configuration: "配置更新失败，请检查回调地址与应用权限。登录应用至少需要一个精确回调地址。",
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
  const [dirty, setDirty] = useState(false);
  const releaseGuard = useLeaveGuard(dirty && !credential);
  const [confirming, setConfirming] = useState<{ action: Action; data?: Record<string, string | string[]> }>();
  const status = refreshedStatus ?? initialWebhookStatus;
  const busy = pending || refreshing;
  const webhook = client.webhooks[0];
  const confirmations: Partial<Record<Action, { title: string; description: string; label: string }>> = {
    disable: { title: `停用“${client.name ?? client.clientId}”？`, description: "此应用将无法继续登录，已有访问令牌和授权会被撤销。请确认接入方已知晓此次停用。", label: "确认停用应用" },
    rotate_secret: { title: `轮换“${client.name ?? client.clientId}”的密钥？`, description: "旧密钥将立即失效，已有令牌会被撤销。请准备更新接入应用的安全配置，新密钥仅显示一次。", label: "确认轮换密钥" },
    rotate_webhook_secret: { title: "轮换事件签名密钥？", description: "旧签名密钥将立即失效。请同步更新事件接收端的验签配置，避免投递失败。新密钥仅显示一次。", label: "确认轮换签名密钥" },
    update_configuration: { title: `保存“${client.name ?? client.clientId}”的登录设置？`, description: "回调地址和权限变更会撤销此应用已有的令牌和授权，用户需要重新登录。", label: "确认保存设置" },
  };
  const confirmation = confirming ? confirmations[confirming.action] : undefined;
  function requestAction(next: Action, data?: Record<string, string | string[]>) {
    setError(undefined);
    if (confirmations[next]) setConfirming({ action: next, data });
    else void action(next, data);
  }
  async function action(action: Action, data: Record<string, string | string[]> = {}) {
    setPending(true); setError(undefined); setNotice(undefined);
    try {
      const response = await fetch(`/api/admin/clients/${encodeURIComponent(client.clientId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...data }) });
      if (!response.ok) { setError(errors[action]); return; }
      const result = await response.json() as { clientSecret?: string; webhookSecret?: string };
      setConfirming(undefined); setDirty(false); releaseGuard();
      setStatus(undefined);
      if (result.clientSecret || result.webhookSecret) setCredential({ clientId: client.clientId, ...result });
      else setNotice(action === "disable" ? "应用已停用。" : action === "enable" ? "应用已启用。" : "设置已保存。");
      startTransition(() => router.refresh());
    } catch { setError("无法连接管理服务，请检查网络后重试。"); }
    finally { setPending(false); }
  }
  function saveLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    requestAction("update_configuration", { redirectUris: String(data.get("redirectUris") ?? "").split(/\s+/).filter(Boolean), scopes: data.getAll("scopes").map(String) });
  }
  function saveWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const endpointUrl = String(data.get("endpointUrl") ?? "").trim();
    const eventTypes = data.getAll("eventTypes").map(String);
    void action("update_webhook", { ...(endpointUrl ? { endpointUrl } : {}), eventTypes });
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
    {!confirming ? <AdminError message={error} /> : null}{notice ? <p className="form-success" role="status">{notice}</p> : null}
    {tab === "login" ? <section className="client-editor">
      <h2>登录设置</h2>
      <form onSubmit={saveLogin} onChange={() => setDirty(true)}>
        <label>登录回调地址（每行一个）<textarea name="redirectUris" rows={4} defaultValue={client.redirectUris.join("\n")} disabled={busy} /></label>
        <ClientScopeFields selected={client.scopes} disabled={busy} />
        <div className="client-save-row"><button disabled={busy || !dirty}>{busy ? "保存中…" : "保存设置"}</button><small>保存会撤销此应用已有的令牌和授权。</small></div>
      </form>
    </section> : tab === "events" ? <section className="client-editor">
      <h2>事件通知</h2><p className="webhook-note">{webhook ? "使用稳定的 HTTPS 地址接收事件。" : "添加接收地址后会生成一次性显示的签名密钥。"}</p>
      <form onSubmit={saveWebhook} onChange={() => setDirty(true)}>
        <label>接收地址<input name="endpointUrl" type="url" defaultValue={webhook?.endpointUrl ?? ""} placeholder="https://app.example/api/internal/hflive/events" disabled={busy} /></label>
        <fieldset className="event-fields" disabled={busy}><legend>订阅的事件</legend>{[{ value: "user.status.changed", title: "账号状态变化", description: "成员停用或恢复时通知应用。" }, { value: "user.profile.changed", title: "个人资料变化", description: "显示名、头像等统一资料更新时通知应用。" }].map((item) => <label key={item.value}><input type="checkbox" name="eventTypes" value={item.value} defaultChecked={webhook ? webhook.eventTypes.includes(item.value) : true} /><span>{item.title}<code>{item.value}</code><small>{item.description}</small></span></label>)}</fieldset>
        <button disabled={busy}>{busy ? "保存中…" : "保存事件设置"}</button>
      </form>
      {webhook ? <div className="webhook-actions"><button className="danger-button" disabled={busy || dirty} onClick={() => requestAction("rotate_webhook_secret")}>轮换签名密钥</button><button disabled={busy} onClick={() => void refreshStatus()}>刷新投递状态</button></div> : null}
      {status ? <p className="webhook-health">事件投递：待处理 {status.counts.pending + status.counts.processing} · 成功 {status.counts.delivered}{status.counts.deadLetter > 0 ? <> · <span className="text-danger">需处理 {status.counts.deadLetter}</span></> : null}{status.recentFailures[0] ? <> · 最近失败 <span className="text-danger">{status.recentFailures[0].lastErrorCode ?? "DELIVERY_FAILED"}</span></> : null}</p> : null}
    </section> : <section className="client-editor">
      <h2>凭据与状态</h2>
      <p className="danger-zone-note">以下操作会影响正在使用此应用的成员。</p>
      <div className="admin-setting-row danger-zone"><div><h3>应用状态 <span className={client.disabled ? "badge danger" : "badge"}>{client.disabled ? "已停用" : "已启用"}</span></h3><p className="field-help">停用将阻止应用继续登录，并撤销已有令牌。</p></div><button className={client.disabled ? "secondary-button" : "danger-button"} disabled={busy} onClick={() => requestAction(client.disabled ? "enable" : "disable")}>{client.disabled ? "启用应用" : "停用应用"}</button></div>
      <div className="admin-setting-row danger-zone"><div><h3>应用密钥</h3><p className="field-help">轮换会撤销已有令牌。新密钥仅显示一次，请及时更新应用配置。</p></div><button className="danger-button" disabled={busy} onClick={() => requestAction("rotate_secret")}>轮换密钥</button></div>
    </section>}
    <ConfirmAction open={Boolean(confirming)} title={confirmation?.title ?? ""} description={confirmation?.description ?? ""} label={confirmation?.label ?? "确认"} busy={busy} error={error} onCancel={() => { setConfirming(undefined); setError(undefined); }} onConfirm={() => { if (confirming) void action(confirming.action, confirming.data); }} />
  </div>;
}
