import type { Metadata } from "next";
import { InvitationAcceptForm } from "@/components/invitation-accept-form";
import { prisma } from "@/lib/prisma";
import { parseInvitationToken } from "@/lib/security/invitation-token";

export const metadata: Metadata = { title: "接受邀请" };

export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const parsed = parseInvitationToken(token);
  const invitation = parsed ? await prisma.invitation.findFirst({
    where: { id: parsed.id, tokenDigest: parsed.tokenDigest, status: "PENDING", expiresAt: { gt: new Date() } },
    select: { username: true },
  }) : null;
  return <main className="auth-main"><section className="panel auth-card">
    <p className="eyebrow">账号邀请</p><h1 className="auth-title">创建 HFLive 账号</h1>
    <p className="auth-copy">确认管理员为你分配的用户名，然后设置显示名和密码。</p>
    {invitation ? <InvitationAcceptForm token={token} assignedUsername={invitation.username ?? undefined} /> : <><p className="form-error" role="alert">此邀请链接无效、已过期或已经使用。请联系管理员重新邀请。</p><a className="form-link" href="/sign-in">返回登录</a></>}
  </section></main>;
}
