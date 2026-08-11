"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { describeConsentPermissions } from "@/lib/consent-permissions";

export function ConsentForm() {
  const searchParams = useSearchParams();
  const scopes = (searchParams.get("scope") ?? "openid")
    .split(" ")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const permissions = describeConsentPermissions(scopes);
  const [pending, setPending] = useState<"accept" | "deny">();
  const [error, setError] = useState<string>();

  async function decide(accept: boolean) {
    setPending(accept ? "accept" : "deny");
    setError(undefined);

    const result = await authClient.oauth2.consent({
      accept,
      scope: accept ? scopes.join(" ") : undefined,
    });

    if (result.error) {
      setError("授权请求已失效或无法处理，请返回应用后重试。");
      setPending(undefined);
      return;
    }

    if (result.data?.url) {
      window.location.assign(result.data.url);
      return;
    }

    setError("授权服务没有返回跳转地址，请重试。");
    setPending(undefined);
  }

  return (
    <>
      <ul className="scope-list">
        {permissions.map((permission) => (
          <li key={permission.title}>
            <span className="scope-dot" aria-hidden="true" />
            <span>
              <strong>{permission.title}</strong>
              <small>{permission.description}</small>
            </span>
          </li>
        ))}
      </ul>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="button-row">
        <button className="secondary-button" type="button" onClick={() => decide(false)} disabled={Boolean(pending)}>
          {pending === "deny" ? "正在取消…" : "取消"}
        </button>
        <button className="primary-button" type="button" onClick={() => decide(true)} disabled={Boolean(pending)}>
          {pending === "accept" ? "正在继续…" : "允许"}
        </button>
      </div>
    </>
  );
}
