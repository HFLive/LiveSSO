import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AdminPageShell } from "@/components/admin-page-shell";
import { AdminMemberDetails } from "@/components/admin-member-details";
import { requireAdminPage } from "@/lib/admin-page";
import { adminHref, adminSearchValue, type AdminSearchParams } from "@/lib/admin-pagination";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "成员资料" };
export default async function MemberPage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<AdminSearchParams> }) {
  const { userId } = await params;
  const search = await searchParams;
  const listQuery = { q: adminSearchValue(search, "q"), page: adminSearchValue(search, "page") };
  const actor = await requireAdminPage(adminHref(`/admin/members/${encodeURIComponent(userId)}`, listQuery));
  if (!z.uuid().safeParse(userId).success) notFound();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, username: true, email: true, identityLabel: true, realName: true, platformRole: true, accountStatus: true } });
  if (!user) notFound();
  return <AdminPageShell active="members" title={user.name} description={user.email} backHref={adminHref("/admin/members", listQuery)} backLabel="返回成员列表"><AdminMemberDetails key={user.id} initialUser={user} isSelf={actor.id === user.id} /></AdminPageShell>;
}
