import type { Metadata } from "next";
import Link from "next/link";
import { AdminPageShell, AdminPagination, AdminSearch } from "@/components/admin-page-shell";
import { requireAdminPage } from "@/lib/admin-page";
import { adminHref, adminPagination, adminSearchValue, type AdminSearchParams } from "@/lib/admin-pagination";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "成员管理" };
export default async function MembersPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  const params = await searchParams;
  const q = adminSearchValue(params, "q");
  await requireAdminPage(adminHref("/admin/members", { q, page: adminSearchValue(params, "page") }));
  const where: Prisma.UserWhereInput = q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { username: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {};
  const pagination = adminPagination(adminSearchValue(params, "page"), await prisma.user.count({ where }));
  const users = await prisma.user.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: pagination.skip, take: pagination.take, select: { id: true, name: true, username: true, email: true, platformRole: true, accountStatus: true } });
  return <AdminPageShell active="members" title="成员" description="查找成员，查看资料和账号状态。" action={<Link className="primary-button" href="/admin/invitations/new">邀请成员</Link>}>
    <AdminSearch path="/admin/members" query={q} placeholder="搜索姓名、用户名或邮箱" />
    <div className="member-list">{users.length ? users.map((user) => <Link className="member-list-row" key={user.id} href={adminHref(`/admin/members/${user.id}`, { q, page: pagination.page })}>
      <span className="member-identity"><strong>{user.name}</strong><small>{user.email}</small></span>
      <code className="member-username">{user.username ? `@${user.username}` : "未设置用户名"}</code>
      <span className="member-role">{user.platformRole === "ADMIN" ? "管理员" : "成员"}</span>
      <span className={user.accountStatus === "ACTIVE" ? "badge" : "badge danger"}>{user.accountStatus === "ACTIVE" ? "正常" : "已停用"}</span>
      <span className="row-arrow" aria-hidden="true">→</span>
    </Link>) : <p className="admin-empty">{q ? "没有找到匹配的成员。" : "暂无成员。"}</p>}</div>
    <AdminPagination pagination={pagination} path="/admin/members" query={{ q }} noun="位成员" />
  </AdminPageShell>;
}
