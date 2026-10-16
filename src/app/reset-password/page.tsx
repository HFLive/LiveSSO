import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth-frame";
import { ResetPasswordForm } from "@/components/password-recovery-forms";
export const metadata: Metadata = { title: "重置密码" };
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  return <AuthFrame>
    <p className="eyebrow">账号恢复</p><h1 className="auth-title">设置新密码</h1>
    <p className="auth-copy">新密码至少 12 个字符。完成后现有会话会被撤销。</p>
    {token && !error ? <ResetPasswordForm token={token} /> : <><p className="form-error" role="alert">此重置链接无效或已过期。</p><a className="form-link" href="/forgot-password">重新找回密码</a></>}
  </AuthFrame>;
}
