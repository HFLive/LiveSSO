import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProfileAvatarForm } from "@/components/profile-avatar-form";
import { auth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { resolveProfileReturnTo } from "@/lib/security/profile-return";

export const metadata: Metadata = { title: "身份资料" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo: requestedReturnTo } = await searchParams;
  const returnTo = await resolveProfileReturnTo(prisma, requestedReturnTo);
  const session = await auth.api.getSession({ headers: await headers() });
  const profilePath = returnTo ? `/profile?returnTo=${encodeURIComponent(returnTo)}` : "/profile";
  if (!session) redirect(`/sign-in?callbackURL=${encodeURIComponent(profilePath)}`);
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { image: true, accountStatus: true } });
  if (user?.accountStatus !== "ACTIVE") redirect("/error?code=forbidden");
  return <main className="profile-shell"><ProfileAvatarForm initialPicture={user.image} storageEnabled={getServerEnv().OBJECT_STORAGE_ENABLED} returnTo={returnTo} /></main>;
}
