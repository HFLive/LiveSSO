import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth-frame";
import { ChallengeForm } from "@/components/challenge-form";
export const metadata: Metadata = { title: "验证登录" };
export default function VerifyLoginPage() { return <AuthFrame>
  <p className="eyebrow">安全验证</p><h1 className="auth-title">验证此次登录</h1>
  <p className="auth-copy">我们已将 6 位验证码发送到你的账号邮箱。请输入验证码继续。</p><ChallengeForm />
</AuthFrame>; }
