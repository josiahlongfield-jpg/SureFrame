"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Menu links with the current page in bold, and others bold while hovered. A hidden bold copy reserves the width so nothing shifts. */
export default function NavLinks({ links, className }: { links: readonly (readonly [string, string])[]; className: string }) {
  const path = usePathname() ?? "";
  return links.map(([href, label]) => {
    const current = path === href || path.startsWith(`${href}/`);
    return (
      <Link key={href} href={href} aria-current={current ? "page" : undefined} className={`group ${className} ${current ? "text-ink" : "text-muted hover:text-ink"}`}>
        <span className="inline-grid">
          <span aria-hidden className="invisible col-start-1 row-start-1 font-semibold">{label}</span>
          <span className={`col-start-1 row-start-1 ${current ? "font-semibold" : "group-hover:font-semibold group-focus-visible:font-semibold"}`}>{label}</span>
        </span>
      </Link>
    );
  });
}
