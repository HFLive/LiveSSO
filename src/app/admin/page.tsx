import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/admin-console";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getClientWebhookStatus } from "@/lib/security/client-service";

export const metadata: Metadata = { title: "内部应用管理" };
export default async function AdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?returnTo=/admin");
  const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { platformRole: true, accountStatus: true } });
  if (actor?.platformRole !== "ADMIN" || actor.accountStatus !== "ACTIVE") redirect("/error?code=forbidden");
  const [clients, users, events] = await Promise.all([
    prisma.oauthClient.findMany({ orderBy: { createdAt: "desc" }, select: { clientId: true, name: true, disabled: true, scopes: true, redirectUris: true, webhooks: { select: { endpointUrl: true, active: true, eventTypes: true } } } }),
    prisma.user.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, username: true, email: true, platformRole: true, accountStatus: true } }),
    prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, eventType: true, outcome: true, severity: true, clientId: true, createdAt: true } }),
  ]);
  const webhookStatus = new Map<string, NonNullable<Awaited<ReturnType<typeof getClientWebhookStatus>>>>();
  for (const client of clients) {
    if (client.webhooks.length === 0) continue;
    const status = await getClientWebhookStatus(prisma, client.clientId);
    if (status) webhookStatus.set(client.clientId, status);
  }
  return <AdminConsole initialClients={clients} initialUsers={users} initialEvents={events} initialWebhookStatus={webhookStatus} />;
}
