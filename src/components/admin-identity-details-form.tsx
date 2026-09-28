"use client";

import { useState, type FormEvent } from "react";

export function AdminIdentityDetailsForm({ userId, identityLabel, realName, onUpdated }: {
  userId: string;
  identityLabel: string | null;
  realName: string | null;
  onUpdated: (details: { identityLabel: string | null; realName: string | null }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const details = {
      identityLabel: String(data.get("identityLabel") ?? "").trim() || null,
      realName: String(data.get("realName") ?? "").trim() || null,
    };
    setPending(true); setError(undefined);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(details),
      });
      if (!response.ok) throw new Error(response.status === 409 ? "资料刚刚发生变化，请重试。" : "保存失败，请重试。");
      onUpdated(details);
      setEditing(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请重试。"); }
    finally { setPending(false); }
  }
  return <div className="identity-details-editor">
    <small>{[identityLabel, realName].filter(Boolean).join(" · ") || "未设置标签和真名"}</small>
    {!editing ? <button type="button" onClick={() => setEditing(true)}>设置身份资料</button> :
      <form onSubmit={submit}>
        <label>标签<input name="identityLabel" defaultValue={identityLabel ?? ""} maxLength={40} disabled={pending} placeholder="例如：教师" /></label>
        <label>真名<input name="realName" defaultValue={realName ?? ""} maxLength={80} disabled={pending} placeholder="可留空" /></label>
        <div className="compact-actions"><button disabled={pending}>{pending ? "保存中…" : "保存"}</button><button type="button" disabled={pending} onClick={() => { setEditing(false); setError(undefined); }}>取消</button></div>
        {error ? <small className="form-error" role="alert">{error}</small> : null}
      </form>}
  </div>;
}
