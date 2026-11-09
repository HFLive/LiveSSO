import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth-frame";
import { ChallengeForm } from "@/components/challenge-form";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSecurityHashSecret } from "@/lib/env";
import { digestSensitiveValue } from "@/lib/security/digest";
import { getLoginChallengeStatus, LoginChallengeError } from "@/lib/security/login-challenge";
export const metadata: Metadata = { title: "验证登录" };
export default async function VerifyLoginPage() {
  const binding = (await cookies()).get("hflive_login_challenge")?.value;
  let status;
  let error = binding ? undefined : "INVALID_CHALLENGE";
  if (binding) {
    try { status = await getLoginChallengeStatus(prisma, digestSensitiveValue("login-challenge-binding", binding, getSecurityHashSecret())); }
    catch (cause) { error = cause instanceof LoginChallengeError ? cause.code : "SERVICE_UNAVAILABLE"; }
  }
  return <AuthFrame>
  <p className="eyebrow">安全验证</p><h1 className="auth-title">验证此次登录</h1>
  <p className="auth-copy">为确认是你本人，请完成邮箱验证。</p><ChallengeForm initialStatus={status} initialError={error} />
</AuthFrame>; }
