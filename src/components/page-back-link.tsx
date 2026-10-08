import Link from "next/link";

export function PageBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link className="page-back-link" href={href} aria-label={label} title={label}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 12H5m7-7-7 7 7 7" />
      </svg>
    </Link>
  );
}
