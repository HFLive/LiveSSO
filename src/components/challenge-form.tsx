"use client";

import { useState, type FormEvent } from "react";

export function ChallengeForm() {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(undefined);
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/hflive/challenge/verify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ otp: data.get("otp"), trustDevice: data.get("trustDevice") === "on" }),
    });
    setPending(false);
    if (!response.ok) return setError("验证码无效、已过期或尝试次数过多。请重新登录。");
    window.location.assign(sessionStorage.getItem("hflive-login-callback") || "/");
  }
  return <form onSubmit={submit}>
    <div className="field"><label htmlFor="otp">6 位验证码</label><input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></div>
    <label className="checkbox-row"><input name="trustDevice" type="checkbox" defaultChecked />信任此设备 30 天</label>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <button className="primary-button" disabled={pending}>{pending ? "正在验证…" : "验证并登录"}</button>
    <a className="form-link" href="/sign-in">返回登录</a>
  </form>;
}
