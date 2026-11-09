"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { confirmPageLeave, finishPageLeave } from "@/lib/use-leave-guard";

export function AccountMenu({ name, email }: { name: string; email: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function leave(switchAccount: boolean) {
    if (pending) return;
    if (!confirmPageLeave()) return;
    setPending(true); setError(undefined);
    try {
      const result = await authClient.signOut({ fetchOptions: { signal: AbortSignal.timeout(15_000) } });
      if (result.error) throw new Error();
      finishPageLeave();
      sessionStorage.removeItem("hflive-login-callback");
      window.location.assign(switchAccount ? "/sign-in" : "/");
    } catch { setError("退出失败，请检查网络后重试。"); setPending(false); }
  }

  return <details className="account-menu" ref={ref} onKeyDown={(event) => {
    if (event.key === "Escape" && ref.current?.open) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); }
  }} onBlur={(event) => { if (!pending && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
    <summary aria-label={`账号菜单：${name}`}><span className="account-menu-avatar" aria-hidden="true">{name.slice(0, 1)}</span><span className="account-menu-label">账号</span><span aria-hidden="true">⌄</span></summary>
    <div className="account-menu-panel">
      <strong>{name}</strong><span>{email}</span>
      <Link href="/profile">个人资料</Link>
      <p>退出统一账号后，各应用的登录状态由各应用管理。</p>
      {error ? <p className="text-danger" role="alert">{error}</p> : null}
      <button type="button" disabled={pending} onClick={() => void leave(true)}>使用其他账号</button>
      <button type="button" disabled={pending} onClick={() => void leave(false)}>{pending ? "正在退出…" : "退出登录"}</button>
    </div>
  </details>;
}
