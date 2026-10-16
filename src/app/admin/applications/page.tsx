import type { Metadata } from "next";
import Link from "next/link";
import { AdminPageShell, AdminPagination, AdminSearch } from "@/components/admin-page-shell";
import { requireAdminPage } from "@/lib/admin-page";
import { adminHref, adminPagination, adminSearchValue, type AdminSearchParams } from "@/lib/admin-pagination";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "应用管理" };
export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  const params = await searchParams;
  const q = adminSearchValue(params, "q");
  await requireAdminPage(adminHref("/admin/applications", { q, page: adminSearchValue(params, "page") }));
  const where: Prisma.OauthClientWhereInput = q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { clientId: { contains: q, mode: "insensitive" } }] } : {};
  const pagination = adminPagination(adminSearchValue(params, "page"), await prisma.oauthClient.count({ where }));
  const clients = await prisma.oauthClient.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: pagination.skip, take: pagination.take, select: { clientId: true, name: true, disabled: true } });
  return <AdminPageShell active="applications" title="应用" description="管理已接入的应用及其登录设置。" action={<Link className="primary-button" href="/admin/applications/new">添加应用</Link>}>
    <AdminSearch path="/admin/applications" query={q} placeholder="搜索应用名称或标识" />
    <div className="application-list">{clients.length ? clients.map((client) => <Link className="application-summary" key={client.clientId} href={adminHref(`/admin/applications/${encodeURIComponent(client.clientId)}`, { q, page: pagination.page })}>
      <span className="application-monogram" aria-hidden="true">{(client.name ?? "A").slice(0, 1).toUpperCase()}</span>
      <span className="application-identity"><strong>{client.name ?? "未命名应用"}</strong><code>{client.clientId}</code></span>
      <span className={client.disabled ? "badge danger" : "badge"}>{client.disabled ? "已停用" : "已启用"}</span>
      <span className="application-disclosure" aria-hidden="true"><span>设置</span> →</span>
    </Link>) : <p className="admin-empty">{q ? "没有找到匹配的应用。" : "暂无应用，添加首个应用后会显示在这里。"}</p>}</div>
    <AdminPagination pagination={pagination} path="/admin/applications" query={{ q }} noun="个应用" />
  </AdminPageShell>;
}
