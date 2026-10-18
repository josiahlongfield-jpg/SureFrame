"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Links = readonly (readonly [string, string])[];

/** Which section a support page belongs to: a conversation is in the inbox, a login or workspace page in Look up. */
function section(path: string) {
  if (/^\/support\/(lookup|users|workspaces)(\/|$)/.test(path)) return "/support/lookup";
  const m = path.match(/^\/support\/(log|accounts|offers)(\/|$)/);
  return m ? `/support/${m[1]}` : "/support";
}

/** The same row of links on every support page, with the current section marked. */
export default function SupportNav({ links }: { links: Links }) {
  const current = section(usePathname() ?? "/support");
  return (
    <nav aria-label="Support" className="flex flex-wrap gap-x-5 gap-y-1 text-sm" data-testid="support-nav">
      {links.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={current === href ? "page" : undefined}
          className={`border-b-2 py-2 ${current === href ? "border-primary font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
