import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { IdentityArt } from "@/components/identity-art";
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

  return (
    <div className="shell portal-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="HFLive Auth 首页"><BrandMark /><span>HFLive <span className="brand-suffix">Auth</span></span></Link>
        <span className="environment">账号中心</span>
      </header>

      <main className="portal-layout" id="main-content">
        <section className="portal-intro" aria-labelledby="portal-title">
          <p className="eyebrow">YOUR HFLIVE ACCOUNT</p>
          <h1 id="portal-title">{signedIn ? <>欢迎回来。<br /><span>从这里继续。</span></> : <>一个账号。<br /><span>连接你的应用。</span></>}</h1>
          <p className="lead">
            {signedIn ? "查看和更新你的账号资料。修改后，已连接的应用会使用最新资料。" : "登录你的 HFLive 账号，继续访问组织应用。"}
          </p>
          <IdentityArt />
        </section>

        <section className="portal-card" aria-label={signedIn ? "当前账号" : "登录入口"}>
          {signedIn && user ? (
            <>
              <div className="portal-account">
                <span className="signed-in-avatar" aria-hidden="true">
                  {user.image ? <Image src={user.image} alt="" width={48} height={48} unoptimized /> : user.name.slice(0, 1).toUpperCase()}
                </span>
                <div><span className="portal-overline">当前账号</span><strong>{user.name}{user.identityLabel || user.realName ? <span className="portal-identity-meta">({[user.identityLabel, user.realName].filter(Boolean).join(" ")})</span> : null}</strong><small>{user.email}</small></div>
              </div>
              <Link className="primary-button button-link" href="/profile">管理个人资料 <span aria-hidden="true">→</span></Link>
              {user.platformRole === "ADMIN" ? <Link className="portal-text-link" href="/admin">进入管理后台 <span aria-hidden="true">→</span></Link> : null}
            </>
          ) : (
            <>
              <span className="portal-overline">账号中心</span>
              <h2>欢迎使用 HFLive</h2>
              <p>使用用户名或邮箱和密码继续。</p>
              <Link className="primary-button button-link" href="/sign-in">登录 <span aria-hidden="true">→</span></Link>
              <Link className="portal-text-link" href="/forgot-password">忘记密码？</Link>
              <p className="portal-card-footnote">首次使用？请打开管理员发送给你的邀请邮件。</p>
            </>
          )}
        </section>
      </main>
      <footer className="site-footer"><span>HFLive 统一身份服务</span><span>HFLIVE / AUTH</span></footer>
    </div>
  );
}
