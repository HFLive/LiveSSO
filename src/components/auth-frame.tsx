import type { ReactNode } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { IdentityArt } from "@/components/identity-art";

export function AuthFrame({ children, featured = false }: { children: ReactNode; featured?: boolean }) {
  return (
    <div className={`auth-layout${featured ? " auth-layout-featured" : ""}`}>
      <header className="auth-topbar">
        <Link className="brand" href="/" aria-label="HFLive Auth 首页"><BrandMark /><span>HFLive <span className="brand-suffix">Auth</span></span></Link>
        <span className="environment">账号中心</span>
      </header>
      <main className="auth-main" id="main-content">
        {featured ? <aside className="auth-story" aria-label="HFLive 统一账号">
          <p className="eyebrow">YOUR HFLIVE ACCOUNT</p>
          <h2>你的 HFLive。<br /><span>从这里继续。</span></h2>
          <p className="auth-story-copy">一个账号，访问你的 HFLive 应用。</p>
          <IdentityArt />
        </aside> : null}
        <section className="auth-card">{children}</section>
      </main>
      <footer className="site-footer"><span>HFLive 统一身份服务</span><span>HFLIVE / AUTH</span></footer>
    </div>
  );
}
