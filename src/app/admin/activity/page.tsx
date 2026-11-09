import type { Metadata } from "next";
import { AdminPageShell, AdminPagination, AdminSearch } from "@/components/admin-page-shell";
import { requireAdminPage } from "@/lib/admin-page";
import { adminHref, adminPagination, adminSearchValue, type AdminSearchParams } from "@/lib/admin-pagination";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import Link from "next/link";
import { AdminSelectFilter } from "@/components/admin-select-filter";
import { auditContext, auditEventLabels, auditOutcomeLabels, auditSeverityLabels, auditTypesForSearch } from "@/lib/audit-display";

export const metadata: Metadata = { title: "操作记录" };
const formatter = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export default async function ActivityPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  const params = await searchParams;
  const q = adminSearchValue(params, "q");
  const requestedOutcome = adminSearchValue(params, "outcome");
  const outcome = ["SUCCESS", "FAILURE", "DENIED"].includes(requestedOutcome) ? requestedOutcome as keyof typeof auditOutcomeLabels : "";
  await requireAdminPage(adminHref("/admin/activity", { q, outcome, page: adminSearchValue(params, "page") }));
  const where: Prisma.AuditEventWhereInput = { ...(q ? { OR: [{ eventType: { contains: q, mode: "insensitive" } }, { eventType: { in: auditTypesForSearch(q) } }] } : {}), ...(outcome ? { outcome } : {}) };
  const pagination = adminPagination(adminSearchValue(params, "page"), await prisma.auditEvent.count({ where }), 20);
  const events = await prisma.auditEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: pagination.skip, take: pagination.take, select: { id: true, eventType: true, actorType: true, actorUserId: true, subjectUserId: true, clientId: true, outcome: true, severity: true, createdAt: true } });
  const userIds = [...new Set(events.flatMap((event) => [event.actorUserId, event.subjectUserId].filter((id): id is string => Boolean(id))))];
  const clientIds = [...new Set(events.flatMap((event) => event.clientId ? [event.clientId] : []))];
  const [users, clients] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, username: true } }),
    prisma.oauthClient.findMany({ where: { clientId: { in: clientIds } }, select: { clientId: true, name: true } }),
  ]);
  const userNames = new Map(users.map((user) => [user.id, user.username ? `${user.name} (@${user.username})` : user.name]));
  const clientNames = new Map(clients.map((client) => [client.clientId, client.name ?? "未命名应用"]));
  return <AdminPageShell active="activity" title="操作记录" description="查看登录与管理活动，按时间从新到旧排列。">
    <AdminSearch path="/admin/activity" query={q} clearHref={adminHref("/admin/activity", { outcome })} placeholder="搜索操作，如登录、邀请或 login"><AdminSelectFilter name="outcome" label="操作结果" value={outcome} options={[{ value: "", label: "全部结果" }, ...Object.entries(auditOutcomeLabels).map(([value, label]) => ({ value, label }))]} /></AdminSearch>
    <div className="list-columns audit-columns"><span>操作 · 共 {pagination.total} 条</span><span>操作者 / 对象</span><span>结果</span><span>时间（北京时间）</span></div>
    <div className="audit-list">{events.length ? events.map((event) => {
      const { actor, subject } = auditContext(event, userNames, clientNames);
      return <article className="audit-row" key={event.id}>
        <div className="audit-event"><strong>{auditEventLabels[event.eventType] ?? "其他操作"}</strong><details><summary>查看详情</summary><dl><dt>事件类型</dt><dd><code>{event.eventType}</code></dd><dt>操作者</dt><dd>{actor}</dd><dt>操作对象</dt><dd>{subject}</dd><dt>时间</dt><dd>{formatter.format(event.createdAt)}</dd></dl></details></div>
        <div className="audit-context"><span>操作者：{actor}</span><span>对象：{event.subjectUserId && userNames.has(event.subjectUserId) ? <Link href={`/admin/members/${event.subjectUserId}`}>{subject}</Link> : event.clientId && clientNames.has(event.clientId) ? <Link href={`/admin/applications/${encodeURIComponent(event.clientId)}`}>{subject}</Link> : subject}</span></div>
        <span className={event.outcome !== "SUCCESS" ? "text-danger" : ""}>{auditOutcomeLabels[event.outcome]}<small>{auditSeverityLabels[event.severity]}</small></span>
        <time dateTime={event.createdAt.toISOString()}>{formatter.format(event.createdAt)}</time>
      </article>;
    }) : <p className="admin-empty">{q || outcome ? "没有找到匹配的操作，请调整筛选条件。" : "暂无操作记录。"}</p>}</div>
    <AdminPagination pagination={pagination} path="/admin/activity" query={{ q, outcome }} />
  </AdminPageShell>;
}
