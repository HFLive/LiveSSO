import "server-only";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/security/admin";

// Check every page request, including direct links and navigation after a role change.
export async function requireAdminPage(returnTo: string) {
  const authorization = await requirePlatformAdmin();
  if ("error" in authorization) {
    if (authorization.status === 401) redirect(`/sign-in?callbackURL=${encodeURIComponent(returnTo)}`);
    redirect("/error?code=forbidden");
  }
  return authorization.actor;
}
