import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session
    ? await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { name: true, username: true, email: true, image: true, platformRole: true, accountStatus: true },
      })
    : null;
  const signedIn = user?.accountStatus === "ACTIVE";

  return (
    <main className="shell portal-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="HFLive Auth 首页"><BrandMark />HFLive Auth</Link>
        <span className="environment">账号中心</span>
      </header>

      <div className="portal-layout">
        <section className="portal-intro" aria-labelledby="portal-title">
          <p className="eyebrow">HFLive Auth</p>
          <h1 id="portal-title">{signedIn ? "欢迎回来。" : "从这里继续。"}</h1>
          <p className="lead">
            {signedIn ? "查看和更新你的账号资料。修改后，已连接的应用会使用最新资料。" : "登录你的 HFLive 账号，继续访问组织应用。"}
          </p>
        </section>

        <section className="panel portal-card" aria-label={signedIn ? "当前账号" : "登录入口"}>
          {signedIn && user ? (
            <>
              <div className="portal-account">
                <span className="signed-in-avatar" aria-hidden="true">
                  {user.image ? <Image src={user.image} alt="" width={48} height={48} unoptimized /> : user.name.slice(0, 1).toUpperCase()}
                </span>
                <div><span className="portal-overline">当前账号</span><strong>{user.name}</strong><small>@{user.username ?? "未设置用户名"} · {user.email}</small></div>
              </div>
              <Link className="primary-button button-link" href="/profile">管理个人资料 <span aria-hidden="true">↗</span></Link>
              {user.platformRole === "ADMIN" ? <Link className="portal-text-link" href="/admin">进入管理后台 <span aria-hidden="true">→</span></Link> : null}
            </>
          ) : (
            <>
              <span className="portal-overline">已有账号</span>
              <h2>登录 HFLive Auth</h2>
              <p>使用用户名或邮箱和密码继续。</p>
              <Link className="primary-button button-link" href="/sign-in">登录 <span aria-hidden="true">→</span></Link>
              <Link className="portal-text-link" href="/forgot-password">忘记密码？</Link>
              <p className="portal-card-footnote">首次使用？请打开管理员发送给你的邀请邮件。</p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
