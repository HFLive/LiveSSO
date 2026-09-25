"use client";
import Link from "next/link";
import { AdminUsernameForm } from "./admin-username-form";
import { useState, type FormEvent } from "react";

type Client = { clientId: string; name: string | null; disabled: boolean | null; scopes: string[]; redirectUris: string[]; webhooks: Array<{ endpointUrl: string; active: boolean; eventTypes: string[] }> };
type WebhookStatus = { counts: { pending: number; processing: number; deadLetter: number; delivered: number }; recentFailures: Array<{ id: string; eventType: string; attemptCount: number; lastErrorCode: string | null; updatedAt: string | Date }> };
type User = { id: string; name: string; username: string | null; email: string; platformRole: string; accountStatus: "ACTIVE" | "DISABLED" };
type Event = { id: string; eventType: string; outcome: string; severity: string; clientId: string | null; createdAt: string | Date };
const auditTimeFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function AdminConsole({ initialClients, initialUsers, initialEvents, initialWebhookStatus }: { initialClients: Client[]; initialUsers: User[]; initialEvents: Event[]; initialWebhookStatus: Map<string, WebhookStatus> }) {
  const [clients, setClients] = useState(initialClients); const [users, setUsers] = useState(initialUsers);
  const [credential, setCredential] = useState<{ clientId: string; clientSecret: string; webhookSecret?: string }>();
  const [webhookStatus, setWebhookStatus] = useState<Record<string, WebhookStatus>>(Object.fromEntries(initialWebhookStatus));
  const [error, setError] = useState<string>(); const [pending, setPending] = useState(false);
  const [createError, setCreateError] = useState<string>();

  async function refreshWebhookStatus(clientId: string) {
    const response = await fetch(`/api/admin/clients/${encodeURIComponent(clientId)}/webhook-status`).catch(() => null);
    if (!response?.ok) return;
    const body = await response.json() as WebhookStatus;
    setWebhookStatus((current) => ({ ...current, [clientId]: body }));
  }

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setCreateError(undefined); setCredential(undefined);
    const form = event.currentTarget; const data = new FormData(form);
    const scopes = data.getAll("scopes").map(String);
    try {
      const response = await fetch("/api/admin/clients", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: data.get("name"), redirectUris: String(data.get("redirectUris") ?? "").split(/\s+/).filter(Boolean), scopes, webhookUrl: String(data.get("webhookUrl") ?? "") || undefined }) });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { details?: { fieldErrors?: Record<string, string[]> } } | null;
        const fields = result?.details?.fieldErrors;
        setCreateError(fields?.redirectUris?.length ? "请输入完整有效的登录回调地址，每行一个且不能包含 #。" : fields?.scopes?.length ? "请至少选择一项应用权限。" : fields?.webhookUrl?.length ? "请输入完整有效的事件接收地址。" : fields?.name?.length ? "应用名称至少需要两个字符。" : "无法创建应用，请检查填写内容后重试。");
        return;
      }
      const body = await response.json();
      setCredential(body); form.reset();
      const refreshed = await fetch("/api/admin/clients").then((result) => result.json()); setClients(refreshed.clients);
    } catch {
      setCreateError("无法连接管理服务，请检查网络后重试。");
    } finally {
      setPending(false);
    }
  }
  async function clientAction(clientId: string, action: "disable" | "enable" | "rotate_secret") {
    setError(undefined); setCredential(undefined);
    const response = await fetch(`/api/admin/clients/${encodeURIComponent(clientId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const body = await response.json(); if (!response.ok) return setError("客户端操作失败。");
    if (action === "rotate_secret") setCredential(body);
    else setClients((current) => current.map((client) => client.clientId === clientId ? { ...client, disabled: action === "disable" } : client));
  }
  async function userAction(userId: string, accountStatus: "ACTIVE" | "DISABLED") {
    const response = await fetch(`/api/admin/users/${userId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountStatus }) });
    if (!response.ok) return setError("账号状态更新失败；管理员不能停用自己。");
    setUsers((current) => current.map((user) => user.id === userId ? { ...user, accountStatus } : user));
  }
  async function updateClient(event: FormEvent<HTMLFormElement>, clientId: string) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const redirectUris = String(data.get("redirectUris") ?? "").split(/\s+/).filter(Boolean);
    const scopes = String(data.get("scopes") ?? "").split(/\s+/).filter(Boolean);
    const response = await fetch(`/api/admin/clients/${encodeURIComponent(clientId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update_configuration", redirectUris, scopes }) });
    if (!response.ok) return setError("配置更新失败。登录 scope 必须至少保留一个精确回调 URI。");
    setClients((current) => current.map((client) => client.clientId === clientId ? { ...client, redirectUris, scopes } : client));
  }
  async function updateWebhook(event: FormEvent<HTMLFormElement>, clientId: string) {
    event.preventDefault(); setError(undefined); setCredential(undefined);
    const data = new FormData(event.currentTarget);
    const body: Record<string, string | string[]> = { action: "update_webhook" };
    const endpointUrl = String(data.get("endpointUrl") ?? "").trim();
    if (endpointUrl) body.endpointUrl = endpointUrl;
    const eventTypes = String(data.get("eventTypes") ?? "").split(/\s+/).filter(Boolean);
    if (eventTypes.length > 0) body.eventTypes = eventTypes;
    const response = await fetch(`/api/admin/clients/${encodeURIComponent(clientId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) return setError("Webhook 更新失败。生产环境必须使用 HTTPS 地址，事件类型只能从已支持类型中选择。");
    if (result.webhookSecret) setCredential({ clientId, clientSecret: "", webhookSecret: result.webhookSecret });
    const refreshed = await fetch("/api/admin/clients").then((result) => result.json()); setClients(refreshed.clients);
    void refreshWebhookStatus(clientId);
  }
  async function rotateWebhookSecret(clientId: string) {
    setError(undefined); setCredential(undefined);
    const response = await fetch(`/api/admin/clients/${encodeURIComponent(clientId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rotate_webhook_secret" }) });
    const body = await response.json(); if (!response.ok) return setError("Webhook 密钥轮换失败。");
    setCredential(body);
  }
  return <main className="admin-shell">
    <header className="admin-header"><div><p className="eyebrow">管理后台</p><h1 className="admin-title">组织管理</h1><p className="admin-copy">管理成员、应用和最近操作。</p></div><nav className="admin-header-actions" aria-label="快捷入口"><Link href="/">账号中心</Link><a href="/admin/invitations" className="secondary-link">邀请成员 <span aria-hidden="true">↗</span></a></nav></header>
    <nav className="admin-nav" aria-label="管理内容"><a href="#applications">应用 <span>{clients.length}</span></a><a href="#members">成员 <span>{users.length}</span></a><a href="#activity">操作记录</a></nav>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {credential ? <section className="secret-panel" role="status"><strong>请立即保存，仅显示一次</strong><code>client_id: {credential.clientId}</code>{credential.clientSecret ? <code>client_secret: {credential.clientSecret}</code> : null}{credential.webhookSecret ? <code>webhook_secret: {credential.webhookSecret}</code> : null}<button className="secondary-button" onClick={() => setCredential(undefined)}>我已保存</button></section> : null}
    <section className="admin-grid" id="applications" aria-label="应用管理">
      <div className="panel admin-list"><h2>已添加的应用</h2>{clients.length === 0 ? <p className="admin-copy">暂无应用。添加首个应用后会显示在这里。</p> : clients.map((client) => { const webhook = client.webhooks[0]; const status = webhookStatus[client.clientId]; const latest = status?.recentFailures[0]; return <article className="admin-item" key={client.clientId}><div><strong>{client.name ?? "未命名应用"}</strong><code>{client.clientId}</code><small>{client.scopes.join(" · ")}</small>{webhook ? <small>事件地址 · {webhook.endpointUrl}</small> : null}{status ? <small className="webhook-health">事件投递：待处理 {status.counts.pending + status.counts.processing} · 成功 {status.counts.delivered}{status.counts.deadLetter > 0 ? <> · <span className="text-danger">需处理 {status.counts.deadLetter}</span></> : null}{latest ? <> · 最近失败 <span className="text-danger">{latest.lastErrorCode ?? "DELIVERY_FAILED"}</span></> : null}</small> : null}<details className="client-editor"><summary>登录设置</summary><form onSubmit={(event) => updateClient(event, client.clientId)}><label>登录回调地址（每行一个）<textarea name="redirectUris" rows={2} defaultValue={client.redirectUris.join("\n")} /></label><label>Scopes（空格分隔）<textarea name="scopes" rows={2} defaultValue={client.scopes.join(" ")} required /></label><button>保存设置</button><small>保存会撤销旧 token 和授权。</small></form></details><details className="client-editor"><summary>事件通知</summary>{webhook ? <p className="webhook-note">使用稳定的 HTTPS 地址接收事件。</p> : <p className="webhook-note">添加地址后会生成一次性显示的签名密钥。</p>}<form onSubmit={(event) => updateWebhook(event, client.clientId)}><label>接收地址<input name="endpointUrl" type="url" defaultValue={webhook?.endpointUrl ?? ""} placeholder="https://app.example/api/internal/hflive/events" /></label><label>事件类型（空格分隔）<input name="eventTypes" defaultValue={webhook?.eventTypes.join(" ") ?? ""} placeholder="user.status.changed user.profile.changed" /></label><button>保存事件设置</button></form>{webhook ? <div className="webhook-actions"><button onClick={() => rotateWebhookSecret(client.clientId)}>轮换签名密钥</button><button onClick={() => void refreshWebhookStatus(client.clientId)}>刷新投递状态</button></div> : null}</details></div><div className="compact-actions"><span className={client.disabled ? "badge danger" : "badge"}>{client.disabled ? "已停用" : "运行中"}</span><button onClick={() => clientAction(client.clientId, client.disabled ? "enable" : "disable")}>{client.disabled ? "启用" : "停用"}</button><button onClick={() => clientAction(client.clientId, "rotate_secret")}>轮换密钥</button></div></article>; })}</div>
      <details className="panel admin-form-panel"><summary>添加应用 <span aria-hidden="true">＋</span></summary><p className="admin-copy">为已批准的应用创建登录或服务凭据。</p>
        <form onSubmit={createClient}><div className="field"><label htmlFor="name">应用名称</label><input id="name" name="name" required minLength={2} /></div>
          <div className="field"><label htmlFor="redirectUris">登录回调地址</label><textarea id="redirectUris" name="redirectUris" rows={3} placeholder="https://app.example/callback" /><p className="field-help">每行一个完整地址，登录时必须精确匹配。</p></div>
          <fieldset className="scope-field"><legend>应用可访问的信息与能力</legend>{["openid", "profile", "email", "offline_access", "directory:user:read", "directory:user:status"].map((scope) => <label key={scope}><input type="checkbox" name="scopes" value={scope} /> {scope}</label>)}</fieldset>
          <div className="field"><label htmlFor="webhookUrl">事件 Webhook（可选）</label><input id="webhookUrl" name="webhookUrl" type="url" placeholder="https://app.example/hflive/events" /></div>
          {createError ? <p className="form-error" role="alert">{createError}</p> : null}
          <button className="primary-button" disabled={pending}>{pending ? "创建中…" : "创建应用"}</button></form>
      </details>

    </section>
    <section className="panel admin-section" id="members"><div className="admin-section-heading"><h2>成员</h2><a href="/admin/invitations">查看邀请 →</a></div><div className="table-wrap"><table><thead><tr><th>成员</th><th>登录用户名</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.name}<small>{user.email}</small></td><td><AdminUsernameForm userId={user.id} username={user.username} onUpdated={(username) => setUsers((current) => current.map((item) => item.id === user.id ? { ...item, username } : item))} /></td><td>{user.platformRole === "ADMIN" ? "管理员" : "成员"}</td><td><span className={user.accountStatus === "ACTIVE" ? "badge" : "badge danger"}>{user.accountStatus === "ACTIVE" ? "正常" : "已停用"}</span></td><td><button onClick={() => userAction(user.id, user.accountStatus === "ACTIVE" ? "DISABLED" : "ACTIVE")}>{user.accountStatus === "ACTIVE" ? "停用" : "恢复"}</button></td></tr>)}</tbody></table></div></section>
    <section className="panel admin-section" id="activity"><h2>最近操作</h2><div className="audit-list">{initialEvents.map((item) => <div className="audit-row" key={item.id}><code>{item.eventType}</code><span>{item.outcome} · {item.severity}</span><time>{auditTimeFormatter.format(new Date(item.createdAt))}</time></div>)}</div></section>
  </main>;
}
