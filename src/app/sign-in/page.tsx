import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
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
    <main className="auth-main">
      <section className="panel auth-card">
        <p className="eyebrow">HFLive Auth 账号</p>
        <h1 className="auth-title">登录 HFLive Auth</h1>
        <p className="auth-copy">使用你的用户名或邮箱继续。新设备可能需要完成额外验证。</p>

        <SignInForm />

        <p className="fine-print">HFLive Auth 不开放公开注册。账号由组织管理员邀请创建。</p>
      </section>
    </main>
  );
}
