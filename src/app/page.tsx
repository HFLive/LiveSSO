export default function Home() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          HFLive Auth
        </div>
        <span className="environment">HFLive 统一身份</span>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">一个 HFLive 账号</p>
          <h1>安全访问 HFLive 服务</h1>
          <p className="lead">
            使用同一个组织账号登录已接入的应用，并在这里管理你的统一头像。
          </p>
          <div className="hero-actions">
            <a className="primary-button button-link" href="/sign-in">登录</a>
            <a className="secondary-button button-link" href="/profile">管理头像</a>
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
