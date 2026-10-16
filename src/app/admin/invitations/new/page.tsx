import type { Metadata } from "next";
import { AdminPageShell } from "@/components/admin-page-shell";
import { InvitationAdminForm } from "@/components/invitation-admin-form";
import { requireAdminPage } from "@/lib/admin-page";

export const metadata: Metadata = { title: "邀请成员" };
export default async function NewInvitationPage() {
  await requireAdminPage("/admin/invitations/new");
  return <AdminPageShell active="invitations" title="邀请成员" description="通过邮箱邀请成员加入组织。" backHref="/admin/invitations" backLabel="返回邀请记录"><div className="invitation-composer"><InvitationAdminForm /></div></AdminPageShell>;
}
