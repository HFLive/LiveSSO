import type { Metadata } from "next";
import { AdminPageShell, AdminPagination, AdminSearch } from "@/components/admin-page-shell";
import { requireAdminPage } from "@/lib/admin-page";
import { adminHref, adminPagination, adminSearchValue, type AdminSearchParams } from "@/lib/admin-pagination";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "操作记录" };
const formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export default async function ActivityPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  const params = await searchParams;
  const q = adminSearchValue(params, "q");
  await requireAdminPage(adminHref("/admin/activity", { q, page: adminSearchValue(params, "page") }));
  const where: Prisma.AuditEventWhereInput = q ? { eventType: { contains: q, mode: "insensitive" } } : {};
  const pagination = adminPagination(adminSearchValue(params, "page"), await prisma.auditEvent.count({ where }), 20);
  const events = await prisma.auditEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: pagination.skip, take: pagination.take, select: { id: true, eventType: true, outcome: true, severity: true, createdAt: true } });
  return <AdminPageShell active="activity" title="操作记录" description="查看登录与管理活动，按时间从新到旧排列。">
    <AdminSearch path="/admin/activity" query={q} placeholder="搜索操作类型，如 login 或 user" />
    <div className="audit-list">{events.length ? events.map((event) => <div className="audit-row" key={event.id}><code>{event.eventType}</code><span className={event.outcome === "FAILURE" ? "text-danger" : undefined}>{event.outcome} · {event.severity}</span><time dateTime={event.createdAt.toISOString()}>{formatter.format(event.createdAt)}</time></div>) : <p className="admin-empty">{q ? "没有找到匹配的操作。" : "暂无操作记录。"}</p>}</div>
    <AdminPagination pagination={pagination} path="/admin/activity" query={{ q }} />
  </AdminPageShell>;
}
