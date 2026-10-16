import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPageShell } from "@/components/admin-page-shell";
import { AdminClientSettings, type ClientSettingsTab } from "@/components/admin-client-settings";
import { requireAdminPage } from "@/lib/admin-page";
import { adminHref, adminSearchValue, type AdminSearchParams } from "@/lib/admin-pagination";
import { getClientWebhookStatus } from "@/lib/security/client-service";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "应用设置" };
export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<AdminSearchParams> }) {
  const { clientId } = await params;
  const search = await searchParams;
  const path = `/admin/applications/${encodeURIComponent(clientId)}`;
  const tabValue = adminSearchValue(search, "tab");
  const tab: ClientSettingsTab = tabValue === "events" || tabValue === "access" ? tabValue : "login";
  const listQuery = { q: adminSearchValue(search, "q"), page: adminSearchValue(search, "page") };
  await requireAdminPage(adminHref(path, { ...listQuery, tab }));
  if (clientId.length > 255) notFound();
  const client = await prisma.oauthClient.findUnique({ where: { clientId }, select: { clientId: true, name: true, disabled: true, scopes: true, redirectUris: true, webhooks: { select: { endpointUrl: true, eventTypes: true } } } });
  if (!client) notFound();
  const status = tab === "events" && client.webhooks.length ? await getClientWebhookStatus(prisma, clientId) : null;
  return <AdminPageShell active="applications" title={client.name ?? "未命名应用"} description="应用设置" backHref={adminHref("/admin/applications", listQuery)} backLabel="返回应用列表">
    <p className="admin-resource-id"><code>{client.clientId}</code></p>
    <nav className="admin-subnav" aria-label="应用设置">{([ ["login", "登录设置"], ["events", "事件通知"], ["access", "凭据与状态"] ] as const).map(([value, label]) => <Link key={value} href={adminHref(path, { ...listQuery, tab: value })} aria-current={tab === value ? "page" : undefined}>{label}</Link>)}</nav>
    <AdminClientSettings key={`${clientId}:${tab}`} client={client} tab={tab} initialWebhookStatus={status} />
  </AdminPageShell>;
}
