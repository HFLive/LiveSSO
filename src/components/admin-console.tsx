"use client";
import { useState, type FormEvent } from "react";

type Client = { clientId: string; name: string | null; disabled: boolean | null; scopes: string[]; redirectUris: string[]; webhooks: Array<{ endpointUrl: string; active: boolean }> };
type User = { id: string; name: string; username: string | null; email: string; platformRole: string; accountStatus: "ACTIVE" | "DISABLED" };
type Event = { id: string; eventType: string; outcome: string; severity: string; clientId: string | null; createdAt: string | Date };
const auditTimeFormatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function AdminConsole({ initialClients, initialUsers, initialEvents }: { initialClients: Client[]; initialUsers: User[]; initialEvents: Event[] }) {
  const [clients, setClients] = useState(initialClients); const [users, setUsers] = useState(initialUsers);
  const [credential, setCredential] = useState<{ clientId: string; clientSecret: string; webhookSecret?: string }>();
  const [error, setError] = useState<string>(); const [pending, setPending] = useState(false);

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(undefined); setCredential(undefined);
    const form = event.currentTarget; const data = new FormData(form);
    const scopes = data.getAll("scopes").map(String);
    const response = await fetch("/api/admin/clients", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: data.get("name"), redirectUris: String(data.get("redirectUris") ?? "").split(/\s+/).filter(Boolean), scopes, webhookUrl: String(data.get("webhookUrl") ?? "") || undefined }) });
    const body = await response.json(); setPending(false);
    if (!response.ok) return setError("无法创建应用。请检查回调地址、scope 与 webhook URL。");
    setCredential(body); form.reset();
    const refreshed = await fetch("/api/admin/clients").then((result) => result.json()); setClients(refreshed.clients);
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
  return <main className="admin-shell">
    <header className="admin-header"><div><p className="eyebrow">HFLive Auth 管理控制台</p><h1 className="admin-title">内部应用管理</h1></div><a href="/admin/invitations" className="secondary-link">邀请成员</a></header>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {credential ? <section className="secret-panel" role="status"><strong>请立即保存，仅显示一次</strong><code>client_id: {credential.clientId}</code><code>client_secret: {credential.clientSecret}</code>{credential.webhookSecret ? <code>webhook_secret: {credential.webhookSecret}</code> : null}<button className="secondary-button" onClick={() => setCredential(undefined)}>我已保存</button></section> : null}
    <section className="admin-grid">
      <div className="panel admin-form-panel"><h2>登记应用</h2><p className="admin-copy">管理员审批即创建。回调 URI 精确匹配；服务凭据只授予选中的 Directory scope。</p>
        <form onSubmit={createClient}><div className="field"><label htmlFor="name">应用名称</label><input id="name" name="name" required minLength={2} /></div>
          <div className="field"><label htmlFor="redirectUris">Redirect URI（每行一个）</label><textarea id="redirectUris" name="redirectUris" rows={3} placeholder="https://app.example/callback" /></div>
          <fieldset className="scope-field"><legend>允许 scopes</legend>{["openid", "profile", "email", "offline_access", "directory:user:read", "directory:user:status"].map((scope) => <label key={scope}><input type="checkbox" name="scopes" value={scope} /> {scope}</label>)}</fieldset>
          <div className="field"><label htmlFor="webhookUrl">事件 Webhook（可选）</label><input id="webhookUrl" name="webhookUrl" type="url" placeholder="https://app.example/hflive/events" /></div>
          <button className="primary-button" disabled={pending}>{pending ? "创建中…" : "审批并创建"}</button></form>
      </div>
      <div className="panel admin-list"><h2>已登记应用</h2>{clients.length === 0 ? <p className="admin-copy">暂无应用。</p> : clients.map((client) => <article className="admin-item" key={client.clientId}><div><strong>{client.name ?? "未命名应用"}</strong><code>{client.clientId}</code><small>{client.scopes.join(" · ")}</small>{client.webhooks[0] ? <small>events → {client.webhooks[0].endpointUrl}</small> : null}<details className="client-editor"><summary>编辑回调与 scopes</summary><form onSubmit={(event) => updateClient(event, client.clientId)}><label>Redirect URI<textarea name="redirectUris" rows={2} defaultValue={client.redirectUris.join("\n")} /></label><label>Scopes（空格分隔）<textarea name="scopes" rows={2} defaultValue={client.scopes.join(" ")} required /></label><button>保存并撤销旧 token</button></form></details></div><div className="compact-actions"><span className={client.disabled ? "badge danger" : "badge"}>{client.disabled ? "停用" : "启用"}</span><button onClick={() => clientAction(client.clientId, client.disabled ? "enable" : "disable")}>{client.disabled ? "启用" : "停用"}</button><button onClick={() => clientAction(client.clientId, "rotate_secret")}>轮换 secret</button></div></article>)}</div>
    </section>
    <section className="panel admin-section"><h2>用户状态</h2><div className="table-wrap"><table><thead><tr><th>用户</th><th>标识</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td>{user.name}<small>{user.email}</small></td><td><code>{user.username ?? user.id}</code></td><td>{user.platformRole}</td><td><span className={user.accountStatus === "ACTIVE" ? "badge" : "badge danger"}>{user.accountStatus}</span></td><td><button onClick={() => userAction(user.id, user.accountStatus === "ACTIVE" ? "DISABLED" : "ACTIVE")}>{user.accountStatus === "ACTIVE" ? "停用" : "恢复"}</button></td></tr>)}</tbody></table></div></section>
    <section className="panel admin-section"><h2>最近审计</h2><div className="audit-list">{initialEvents.map((item) => <div className="audit-row" key={item.id}><code>{item.eventType}</code><span>{item.outcome} · {item.severity}</span><time>{auditTimeFormatter.format(new Date(item.createdAt))}</time></div>)}</div></section>
  </main>;
}
