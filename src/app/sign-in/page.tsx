import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
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
    <main className="auth-main auth-entry">
      <Link className="brand auth-brand" href="/"><BrandMark />HFLive Auth</Link>
      <section className="panel auth-card">
        <p className="eyebrow">欢迎回来</p>
        <h1 className="auth-title">登录</h1>
        <p className="auth-copy">使用 HFLive Auth 账号继续。</p>

        <SignInForm />

        <p className="auth-help">还没有账号？请使用管理员发来的邀请链接。</p>
      </section>
    </main>
  );
}
