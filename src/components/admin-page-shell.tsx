import Link from "next/link";
import type { ReactNode } from "react";
import { PageBackLink } from "@/components/page-back-link";
import { adminHref, type adminPagination } from "@/lib/admin-pagination";

type Section = "applications" | "members" | "invitations" | "activity";
const sections: Array<{ key: Section; label: string }> = [
  { key: "applications", label: "应用" },
  { key: "members", label: "成员" },
  { key: "invitations", label: "邀请" },
  { key: "activity", label: "操作记录" },
];

export function AdminPageShell({ active, title, description, backHref = "/", backLabel = "返回账号中心", action, children }: {
  active: Section; title: string; description: string; backHref?: string; backLabel?: string; action?: ReactNode; children: ReactNode;
}) {
  return <main className="admin-shell" id="main-content">
    <header className="admin-header">
      <div><p className="eyebrow">组织管理</p><div className="page-heading"><PageBackLink href={backHref} label={backLabel} /><h1 className="admin-title">{title}</h1></div><p className="admin-copy">{description}</p></div>
      {action ? <div className="admin-header-actions">{action}</div> : null}
    </header>
    <nav className="admin-nav" aria-label="管理导航">{sections.map(({ key, label }) => <Link key={key} href={`/admin/${key}`} aria-current={active === key ? "page" : undefined}>{label}</Link>)}</nav>
    <div className="admin-page-content">{children}</div>
  </main>;
}

export function AdminSearch({ path, query, placeholder, clearHref = path, children }: { path: string; query: string; placeholder: string; clearHref?: string; children?: ReactNode }) {
  return <form className="admin-search" action={path} method="get" role="search">
    <input key={query} type="search" name="q" defaultValue={query} placeholder={placeholder} aria-label={placeholder} maxLength={120} />
    {children}<button type="submit" className="secondary-button">搜索</button>
    {query ? <Link className="admin-text-link" href={clearHref}>清除</Link> : null}
  </form>;
}

export function AdminPagination({ pagination, path, query = {}, noun = "条记录" }: {
  pagination: ReturnType<typeof adminPagination>; path: string; query?: Record<string, string>; noun?: string;
}) {
  const { total, page, pages, skip, take } = pagination;
  return <nav className="admin-pagination" aria-label="列表分页">
    <span>{total ? `${skip + 1}–${Math.min(skip + take, total)} / ${total} ${noun}` : `共 0 ${noun}`}</span>
    {pages > 1 ? <div>
      {page > 1 ? <Link href={adminHref(path, { ...query, page: page - 1 })} rel="prev">上一页</Link> : <span aria-disabled="true">上一页</span>}
      <span aria-current="page">{page} / {pages}</span>
      {page < pages ? <Link href={adminHref(path, { ...query, page: page + 1 })} rel="next">下一页</Link> : <span aria-disabled="true">下一页</span>}
    </div> : null}
  </nav>;
}
