import type { Metadata } from "next";
import Link from "next/link";
import { AdminPageShell, AdminPagination, AdminSearch } from "@/components/admin-page-shell";
import { InvitationList } from "@/components/invitation-list";
import { requireAdminPage } from "@/lib/admin-page";
import { adminHref, adminPagination, adminSearchValue, type AdminSearchParams } from "@/lib/admin-pagination";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "成员邀请" };
export default async function InvitationsPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  const params = await searchParams;
  const q = adminSearchValue(params, "q");
  const state = adminSearchValue(params, "state") === "history" ? "history" : "active";
  await requireAdminPage(adminHref("/admin/invitations", { q, state, page: adminSearchValue(params, "page") }));
  const now = new Date();
  const where: Prisma.InvitationWhereInput = { AND: [
    state === "active" ? { status: "PENDING", expiresAt: { gt: now } } : { OR: [{ status: { not: "PENDING" } }, { expiresAt: { lte: now } }] },
    q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { username: { contains: q, mode: "insensitive" } }] } : {},
  ] };
  const pagination = adminPagination(adminSearchValue(params, "page"), await prisma.invitation.count({ where }));
  const records = await prisma.invitation.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: pagination.skip, take: pagination.take, select: { id: true, email: true, username: true, identityLabel: true, realName: true, status: true, createdAt: true, expiresAt: true, acceptedAt: true, revokedAt: true } });
  const invitations = records.map((item) => ({ ...item, status: item.status === "PENDING" && item.expiresAt <= now ? "EXPIRED" as const : item.status }));
  return <AdminPageShell active="invitations" title="邀请" description="查看邀请状态，撤回尚未接受的邀请。" action={<Link className="primary-button" href="/admin/invitations/new">发送邀请</Link>}>
    <AdminSearch path="/admin/invitations" query={q} clearHref={adminHref("/admin/invitations", { state })} placeholder="搜索邀请邮箱或用户名"><select name="state" defaultValue={state} aria-label="邀请状态"><option value="active">待接受</option><option value="history">历史记录</option></select></AdminSearch>
    <InvitationList initialInvitations={invitations} />
    <AdminPagination pagination={pagination} path="/admin/invitations" query={{ q, state }} noun="条邀请" />
  </AdminPageShell>;
}
