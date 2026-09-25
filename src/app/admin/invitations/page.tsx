import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { InvitationAdminForm } from "@/components/invitation-admin-form";
import { InvitationList } from "@/components/invitation-list";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listInvitations } from "@/lib/security/invitation-management";
export const metadata: Metadata = { title: "成员邀请" };
export default async function InvitationsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?returnTo=/admin/invitations");
  const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { platformRole: true, accountStatus: true } });
  if (actor?.platformRole !== "ADMIN" || actor.accountStatus !== "ACTIVE") redirect("/error?code=forbidden");
  const invitations = await listInvitations(prisma);
  return <main className="invitation-shell">
    <header className="invitation-header"><div><p className="eyebrow">管理员</p><h1 className="auth-title">成员邀请</h1><p className="auth-copy">发送邀请、查看状态和撤回尚未接受的邀请。</p></div><a href="/admin" className="secondary-link">返回管理控制台</a></header>
    <div className="invitation-grid"><section className="panel invitation-form-panel"><h2>发送邀请</h2><p className="admin-copy">指定成员邮箱、全局用户名和有效期。受邀账号始终以普通用户权限创建。</p><InvitationAdminForm /></section>
    <InvitationList initialInvitations={invitations} /></div>
  </main>;
}
