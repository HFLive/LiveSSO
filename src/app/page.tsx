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
        select: {
          name: true,
          username: true,
          email: true,
          image: true,
          platformRole: true,
          accountStatus: true,
        },
      })
    : null;
  const signedIn = user?.accountStatus === "ACTIVE";

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="HFLive Auth 首页">
          <BrandMark />
          HFLive Auth
        </Link>
        <span className="environment">Live 统一认证系统</span>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">一个 HFLive Auth 账号</p>
          <h1>安全访问<br />组织应用</h1>
          <p className="lead">
            使用同一个账号登录已接入的应用，并在这里集中管理你的个人资料。
          </p>
          {signedIn ? (
            <div className="signed-in-summary" aria-label="当前登录账号">
              <span className="signed-in-avatar" aria-hidden="true">
                {user.image ? <Image src={user.image} alt="" width={38} height={38} unoptimized /> : user.name.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{user.name}</strong>
                <small>@{user.username ?? "未设置用户名"} · {user.email}</small>
              </span>
            </div>
          ) : null}
          <div className="hero-actions">
            {signedIn ? (
              <>
                <a className="primary-button button-link" href="/profile">管理资料</a>
                {user.platformRole === "ADMIN" ? <a className="secondary-button button-link" href="/admin">管理后台</a> : null}
              </>
            ) : (
              <>
                <a className="primary-button button-link" href="/sign-in">登录</a>
                <a className="secondary-button button-link" href="/profile">管理资料</a>
              </>
            )}
          </div>
        </div>

        <aside className="panel" aria-label="账号说明">
          <div className="status-row">
            <span>账号创建</span>
            <span className="status-value">管理员邀请</span>
          </div>
          <div className="status-row">
            <span>应用接入</span>
            <span className="status-value">管理员审批</span>
          </div>
          <div className="status-row">
            <span>统一资料</span>
            <span className="status-value">集中管理</span>
          </div>
        </aside>
      </section>
    </main>
  );
}
