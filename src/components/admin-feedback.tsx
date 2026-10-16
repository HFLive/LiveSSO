"use client";
import { useEffect, useRef } from "react";

export type AdminCredential = { clientId: string; clientSecret?: string; webhookSecret?: string };

export function AdminError({ message }: { message: string | undefined }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (message) ref.current?.focus(); }, [message]);
  return message ? <p className="form-error" role="alert" tabIndex={-1} ref={ref}>{message}</p> : null;
}

export function AdminCredentialNotice({ credential, onDone }: { credential: AdminCredential; onDone: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <section className="secret-panel" role="status" tabIndex={-1} ref={ref}>
    <strong>请立即保存，仅显示一次</strong>
    <p className="admin-copy">离开页面后无法再次查看这些密钥。</p>
    <code>client_id: {credential.clientId}</code>
    {credential.clientSecret ? <code>client_secret: {credential.clientSecret}</code> : null}
    {credential.webhookSecret ? <code>webhook_secret: {credential.webhookSecret}</code> : null}
    <button className="secondary-button" onClick={onDone}>我已保存</button>
  </section>;
}
