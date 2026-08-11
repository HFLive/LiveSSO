import type { Metadata } from "next";
export const metadata: Metadata = { title: "无法继续" };
export default function ErrorPage() { return <main className="auth-main"><section className="panel auth-card">
  <p className="eyebrow">操作未完成</p><h1 className="auth-title">无法继续</h1><p className="auth-copy">链接可能已经失效，或服务暂时无法处理此次操作。请重新登录；如果问题持续，请联系管理员。</p>
  <a className="primary-button button-link" href="/sign-in">返回登录</a>
</section></main>; }
