"use client";

import { useEffect, useState, type FormEvent } from "react";
import { loginChallengeErrors, type LoginChallengeStatus } from "@/lib/login-challenge-status";
import { useRouter } from "next/navigation";

export function ChallengeForm({ initialStatus, initialError }: { initialStatus?: LoginChallengeStatus; initialError?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<LoginChallengeStatus | undefined>(initialStatus);
  const [error, setError] = useState<string | undefined>(initialError ? loginChallengeErrors[initialError] ?? "暂时无法读取验证状态，请重试。" : undefined);
  const [notice, setNotice] = useState<string>();
  const [pending, setPending] = useState<"loading" | "verify" | "resend" | undefined>();
  const [now, setNow] = useState(initialStatus?.serverTime ?? 0);
  const [invalid, setInvalid] = useState(Boolean(initialError && ["INVALID_CHALLENGE", "CHALLENGE_EXPIRED", "CHALLENGE_LOCKED"].includes(initialError)));
  const [otp, setOtp] = useState("");

  async function loadStatus() {
    try {
      const response = await fetch("/api/auth/hflive/challenge/status", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok) {
        setInvalid(response.status === 401);
        setError(loginChallengeErrors[data.code] ?? "暂时无法读取验证状态，请重试。");
        return;
      }
      setStatus(data); setNow(data.serverTime); setInvalid(false);
    } catch { setError("无法连接验证服务，请检查网络后重试。"); }
    finally { setPending(undefined); }
  }
  const serverTime = status?.serverTime;
  useEffect(() => {
    if (serverTime === undefined) return;
    const started = performance.now();
    const timer = window.setInterval(() => setNow(serverTime + performance.now() - started), 1000);
    return () => window.clearInterval(timer);
  }, [serverTime]);

  const expiresIn = status ? Math.max(0, Math.ceil((Date.parse(status.expiresAt) - now) / 1000)) : 0;
  const resendIn = status ? Math.max(0, Math.ceil((Date.parse(status.resendAt) - now) / 1000)) : 0;
  const expired = Boolean(status && !expiresIn);

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending) return;
    const mode = event ? "verify" : "resend";
    const trustDevice = event ? new FormData(event.currentTarget).get("trustDevice") === "on" : false;
    setPending(mode); setError(undefined); setNotice(undefined);
    try {
      const response = await fetch(`/api/auth/hflive/challenge/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(mode === "verify" ? { otp, trustDevice } : {}), signal: AbortSignal.timeout(15_000) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setInvalid(["INVALID_CHALLENGE", "CHALLENGE_EXPIRED", "CHALLENGE_LOCKED"].includes(data.code));
        setError(loginChallengeErrors[data.code] ?? "暂时无法完成验证，请稍后重试。");
        if (data.code === "INVALID_OTP" && status) setStatus({ ...status, remainingAttempts: Math.max(0, status.remainingAttempts - 1) });
        if (mode === "resend") {
          const latest = await fetch("/api/auth/hflive/challenge/status", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
          if (latest.ok) { const latestStatus = await latest.json(); setStatus(latestStatus); setNow(latestStatus.serverTime); }
        }
        return;
      }
      if (mode === "resend") {
        setStatus(data); setNow(data.serverTime); setOtp(""); setNotice("新的验证码已发送，请使用最新邮件中的验证码。");
      } else {
        const callback = sessionStorage.getItem("hflive-login-callback");
        sessionStorage.removeItem("hflive-login-callback");
        window.location.assign(callback || "/");
      }
    } catch { setError("无法连接验证服务，请检查网络后重试。你可以重新提交。"); }
    finally { setPending(undefined); }
  }

  return <>
    {pending === "loading" ? <p role="status" className="auth-copy">正在读取验证状态…</p> : null}
    {status && !invalid && !expired ? <form onSubmit={submit} aria-busy={Boolean(pending)}>
      <p className="challenge-destination">验证码已发送至 <strong>{status.maskedEmail}</strong></p>
      <p className="field-help">有效期剩余 {Math.floor(expiresIn / 60)} 分 {String(expiresIn % 60).padStart(2, "0")} 秒 · 可尝试 {status.remainingAttempts} 次</p>
      <div className="field"><label htmlFor="otp">6 位验证码</label><input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={otp} onChange={(event) => setOtp(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? "challenge-error" : undefined} disabled={Boolean(pending)} /></div>
      <label className="checkbox-row"><input name="trustDevice" type="checkbox" disabled={Boolean(pending)} />信任此设备并保持登录 30 天</label>
      {error ? <p className="form-error" role="alert" id="challenge-error">{error}</p> : null}
      {notice ? <p className="form-success" role="status">{notice}</p> : null}
      <button className="primary-button" disabled={Boolean(pending)}>{pending === "verify" ? "正在验证…" : "验证并登录"}</button>
      <button type="button" className="form-link text-button" disabled={Boolean(pending) || resendIn > 0 || !status.canResend} onClick={() => void submit()}>{pending === "resend" ? "正在发送…" : !status.canResend ? "重发次数已用完，请重新登录" : resendIn > 0 ? `${resendIn} 秒后可重新发送` : "重新发送验证码"}</button>
    </form> : <>
      {expired ? <p className="form-error" role="alert">验证码已过期，请重新登录。</p> : error ? <p className="form-error" role="alert">{error}</p> : null}
      {!invalid && !expired && !pending ? <button className="secondary-button" onClick={() => { setPending("loading"); setError(undefined); void loadStatus(); }}>重新读取验证状态</button> : null}
    </>}
    <a className="form-link" href="/sign-in" onClick={(event) => {
      const callback = sessionStorage.getItem("hflive-login-callback");
      if (!callback) return;
      try {
        const target = new URL(callback, window.location.origin);
        if (target.origin === window.location.origin) { event.preventDefault(); router.push(`/sign-in?${new URLSearchParams({ callbackURL: target.href })}`); }
      } catch { sessionStorage.removeItem("hflive-login-callback"); }
    }}>返回登录</a>
  </>;
}
