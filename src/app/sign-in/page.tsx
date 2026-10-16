import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { SignInForm } from "@/components/sign-in-form";
import { resolveAuthenticatedDestination } from "@/lib/authenticated-destination";
import { auth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: "登录",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, query] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    searchParams,
  ]);
  if (session) {
    const current = new URL("/sign-in", getServerEnv().BETTER_AUTH_URL);
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => current.searchParams.append(key, item));
      else if (value !== undefined) current.searchParams.set(key, value);
    }
    redirect(resolveAuthenticatedDestination(current.href));
  }

  return (
    <AuthFrame featured>
        <p className="eyebrow">欢迎回来</p>
        <h1 className="auth-title">登录你的账号</h1>
        <p className="auth-copy">登录后，继续访问你的组织应用。</p>

        <SignInForm />

        <p className="auth-help">首次使用？<br />请通过管理员发送的邀请链接创建账号。</p>
    </AuthFrame>
  );
}
