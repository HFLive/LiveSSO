import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { AccountMenu } from "@/components/account-menu";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { name: true, identityLabel: true, realName: true, email: true, image: true, platformRole: true, accountStatus: true },
      })
    : null;
  const signedIn = user?.accountStatus === "ACTIVE";
  if (!signedIn || !user) redirect("/sign-in");

  return (
    <div className="shell portal-shell portal-account-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="HFLive Auth 首页"><BrandMark /><span>HFLive <span className="brand-suffix">Auth</span></span></Link>
        <AccountMenu name={user.name} email={user.email} />
      </header>

      <main className="portal-layout portal-account-layout" id="main-content">
        <section className="portal-intro" aria-labelledby="portal-title">
          <h1 id="portal-title">账号中心</h1>
          <p className="lead">管理你的个人资料、登录方式与账号安全。</p>
        </section>

        <section className="portal-card" aria-label="当前账号">
              <div className="portal-account">
                <span className="signed-in-avatar" aria-hidden="true">
                  {user.image ? <Image src={user.image} alt="" width={48} height={48} unoptimized /> : user.name.slice(0, 1).toUpperCase()}
                </span>
                <div><span className="portal-overline">当前账号</span><strong>{user.name}{user.identityLabel || user.realName ? <span className="portal-identity-meta">({[user.identityLabel, user.realName].filter(Boolean).join(" ")})</span> : null}</strong><small>{user.email}</small></div>
              </div>
              <Link className="primary-button button-link" href="/profile">管理个人资料 <span aria-hidden="true">→</span></Link>
              <Link className="portal-text-link" href="/profile?tab=security">登录与安全 <span aria-hidden="true">→</span></Link>
              {user.platformRole === "ADMIN" ? <Link className="portal-text-link" href="/admin">进入管理后台 <span aria-hidden="true">→</span></Link> : null}
        </section>
      </main>
      <footer className="site-footer"><span>HFLive 统一身份服务</span><span>HFLIVE / AUTH</span></footer>
    </div>
  );
}
