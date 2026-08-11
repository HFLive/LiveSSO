"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { resolveLoginCallback } from "@/lib/login-callback";

function getFriendlyError(code?: string) {
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_USERNAME_OR_PASSWORD":
    case "INVALID_CREDENTIALS":
      return "用户名、邮箱或密码不正确。";
    case "TOO_MANY_REQUESTS":
      return "尝试次数过多，请稍后再试。";
    case "USER_BANNED":
      return "此账号目前不可用，请联系管理员。";
    default:
      return "暂时无法登录，请稍后重试。";
  }
}

export function SignInForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setPending(true);

    const normalizedIdentifier = identifier.trim();
    const callbackURL = resolveLoginCallback(window.location.href);
    const response = await fetch("/api/auth/hflive/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: normalizedIdentifier, password, callbackURL }),
    });
    const result = await response.json().catch(() => ({}));

    setPending(false);

    if (!response.ok) {
      setError(getFriendlyError(result.code));
      return;
    }
    if (result.challengeRequired) {
      if (result.url) sessionStorage.setItem("hflive-login-callback", result.url);
      else sessionStorage.removeItem("hflive-login-callback");
      router.push("/verify-login");
      return;
    }
    if (result.url) window.location.assign(result.url);
    else router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="identifier">用户名或邮箱</label>
        <input
          id="identifier"
          name="identifier"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="password">密码</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={12}
          required
        />
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "正在验证…" : "继续"}
      </button>
      <a className="form-link" href="/forgot-password">忘记密码？</a>
    </form>
  );
}
