import type { Metadata } from "next";
import { InvitationAdminForm } from "@/components/invitation-admin-form";
export const metadata: Metadata = { title: "成员邀请" };
export default function InvitationsPage() { return <main className="auth-main"><section className="panel auth-card">
  <p className="eyebrow">管理员</p><h1 className="auth-title">邀请成员</h1><p className="auth-copy">指定成员邮箱、全局用户名和链接有效期。账号始终以普通用户权限创建。</p><InvitationAdminForm />
</section></main>; }
