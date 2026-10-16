"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminCredentialNotice, AdminError, type AdminCredential } from "@/components/admin-feedback";

export function AdminCreateClientForm() {
  const router = useRouter();
  const [credential, setCredential] = useState<AdminCredential>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(undefined);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/clients", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: data.get("name"), redirectUris: String(data.get("redirectUris") ?? "").split(/\s+/).filter(Boolean), scopes: data.getAll("scopes").map(String), webhookUrl: String(data.get("webhookUrl") ?? "") || undefined }) });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { details?: { fieldErrors?: Record<string, string[]> } } | null;
        const fields = result?.details?.fieldErrors;
        setError(fields?.redirectUris?.length ? "请输入完整有效的登录回调地址，每行一个且不能包含 #。" : fields?.scopes?.length ? "请至少选择一项应用权限。" : fields?.webhookUrl?.length ? "请输入完整有效的事件接收地址。" : fields?.name?.length ? "应用名称至少需要两个字符。" : "无法创建应用，请检查填写内容后重试。");
        return;
      }
      setCredential(await response.json() as AdminCredential);
      router.refresh();
    } catch { setError("无法连接管理服务，请检查网络后重试。"); }
    finally { setPending(false); }
  }
  if (credential) return <AdminCredentialNotice credential={credential} onDone={() => router.replace(`/admin/applications/${encodeURIComponent(credential.clientId)}`)} />;
  return <form className="admin-create-form" onSubmit={createClient}>
    <div className="field"><label htmlFor="name">应用名称</label><input id="name" name="name" required minLength={2} maxLength={120} disabled={pending} /></div>
    <div className="field"><label htmlFor="redirectUris">登录回调地址</label><textarea id="redirectUris" name="redirectUris" rows={3} placeholder="https://app.example/callback" disabled={pending} /><p className="field-help">每行一个完整地址，登录时必须精确匹配。</p></div>
    <fieldset className="scope-field" disabled={pending}><legend>应用可访问的信息与能力</legend>{["openid", "profile", "email", "offline_access", "directory:user:read", "directory:user:status"].map((scope) => <label key={scope}><input type="checkbox" name="scopes" value={scope} /> {scope}</label>)}</fieldset>
    <div className="field"><label htmlFor="webhookUrl">事件 Webhook（可选）</label><input id="webhookUrl" name="webhookUrl" type="url" placeholder="https://app.example/hflive/events" disabled={pending} /></div>
    <AdminError message={error} />
    <button className="primary-button" disabled={pending}>{pending ? "创建中…" : "创建应用"}</button>
  </form>;
}
