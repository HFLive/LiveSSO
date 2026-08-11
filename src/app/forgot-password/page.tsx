import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/password-recovery-forms";
export const metadata: Metadata = { title: "找回密码" };
export default function ForgotPasswordPage() { return <main className="auth-main"><section className="panel auth-card">
  <p className="eyebrow">账号恢复</p><h1 className="auth-title">找回密码</h1>
  <p className="auth-copy">输入你的账号邮箱，我们会向可用账号发送重置链接。</p><ForgotPasswordForm />
  <a className="form-link" href="/sign-in">返回登录</a>
</section></main>; }
