"use client";
import { useEffect, useRef, useState } from "react";
import { useLeaveGuard } from "@/lib/use-leave-guard";

export type AdminCredential = { clientId: string; clientSecret?: string; webhookSecret?: string };

export function AdminError({ message }: { message: string | undefined }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (message) ref.current?.focus(); }, [message]);
  return message ? <p className="form-error" role="alert" tabIndex={-1} ref={ref}>{message}</p> : null;
}

export function AdminCredentialNotice({ credential, onDone }: { credential: AdminCredential; onDone: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const releaseGuard = useLeaveGuard(true, "这些密钥仅显示一次。离开后无法再次查看，请确认已保存。仍要离开吗？");
  const [notice, setNotice] = useState<string>();
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { ref.current?.focus(); }, []);
  async function copy(label: string, value: string) {
    try { await navigator.clipboard.writeText(value); setNotice(`${label}已复制，请保存到应用的安全配置中。`); }
    catch { setNotice("无法访问剪贴板，请显示后手动复制密钥。"); }
  }
  return <section className="secret-panel" role="status" tabIndex={-1} ref={ref}>
    <strong>请立即保存，仅显示一次</strong>
    <p className="admin-copy">离开页面后无法再次查看这些密钥。</p>
    {[{ key: "client_id", label: "应用标识", value: credential.clientId }, { key: "client_secret", label: "应用密钥", value: credential.clientSecret }, { key: "webhook_secret", label: "签名密钥", value: credential.webhookSecret }].filter((field) => field.value).map((field) => <div className="credential-field" key={field.key}><span>{field.label} <code>{field.key}</code></span><div><code>{field.key === "client_id" || revealed ? field.value : "••••••••••••••••"}</code><button className="secondary-button" type="button" onClick={() => void copy(field.label, field.value!)}>复制{field.label}</button></div></div>)}
    <button className="admin-text-button" type="button" aria-pressed={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? "隐藏密钥" : "显示密钥"}</button>
    {notice ? <p className="field-help" role="status">{notice}</p> : null}
    <button className="secondary-button" onClick={() => { releaseGuard(); onDone(); }}>我已保存</button>
  </section>;
}
