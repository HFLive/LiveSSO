import type { Metadata } from "next";
import { AdminPageShell } from "@/components/admin-page-shell";
import { AdminCreateClientForm } from "@/components/admin-create-client-form";
import { requireAdminPage } from "@/lib/admin-page";

export const metadata: Metadata = { title: "添加应用" };
export default async function NewApplicationPage() {
  await requireAdminPage("/admin/applications/new");
  return <AdminPageShell active="applications" title="添加应用" description="为已批准的应用创建登录或服务凭据。" backHref="/admin/applications" backLabel="返回应用列表"><AdminCreateClientForm /></AdminPageShell>;
}
