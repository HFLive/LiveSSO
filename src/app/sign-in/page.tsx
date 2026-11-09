import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { SignInForm } from "@/components/sign-in-form";
import { resolveAuthenticatedDestination } from "@/lib/authenticated-destination";
import { auth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getLoginApplication } from "@/lib/login-application";

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
  const current = new URL("/sign-in", getServerEnv().BETTER_AUTH_URL);
  for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => current.searchParams.append(key, item));
      else if (value !== undefined) current.searchParams.set(key, value);
  }
  if (session) {
    redirect(resolveAuthenticatedDestination(current.href));
  }
  const applicationName = await getLoginApplication(prisma, current.href);

  return (
    <AuthFrame featured>
        <h1 className="auth-title">登录你的账号</h1>
        <p className="auth-copy">{applicationName ? <>登录后，继续前往 <strong className="auth-application">{applicationName}</strong>。</> : "登录后，管理资料或访问你的组织应用。"}</p>

        <SignInForm />

        <p className="auth-help">首次使用？<br />请通过管理员发送的邀请链接创建账号。</p>
    </AuthFrame>
  );
}
