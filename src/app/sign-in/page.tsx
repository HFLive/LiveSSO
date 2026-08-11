import type { Metadata } from "next";
import { SignInForm } from "@/components/sign-in-form";

export const metadata: Metadata = {
  title: "登录",
};

export default function SignInPage() {
  return (
    <main className="auth-main">
      <section className="panel auth-card">
        <p className="eyebrow">HFLive 账号</p>
        <h1 className="auth-title">登录 HFLive</h1>
        <p className="auth-copy">使用你的用户名或邮箱继续。新设备可能需要完成额外验证。</p>

        <SignInForm />

        <p className="fine-print">HFLive Auth 不开放公开注册。账号由组织管理员邀请创建。</p>
      </section>
    </main>
  );
}
