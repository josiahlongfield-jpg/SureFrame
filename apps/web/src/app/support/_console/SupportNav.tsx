"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

type Links = readonly (readonly [string, string])[];

/** Which section a support page belongs to: a conversation is in the inbox, a login or workspace page in Look up. */
function section(path: string) {
  if (/^\/support\/(lookup|users|workspaces)(\/|$)/.test(path)) return "/support/lookup";
  const m = path.match(/^\/support\/(log|accounts|offers)(\/|$)/);
  return m ? `/support/${m[1]}` : "/support";
}

/**
 * The same row of links on every support page, with the current section marked. One row that scrolls sideways on a
 * narrow phone rather than wrapping onto a second line (P59), with the current section scrolled into view.
 */
export default function SupportNav({ links }: { links: Links }) {
  const current = section(usePathname() ?? "/support");
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = nav.current;
    const on = el?.querySelector<HTMLElement>("[aria-current=page]");
    if (!el || !on) return;
    const [r, box] = [on.getBoundingClientRect(), el.getBoundingClientRect()];
    if (r.left < box.left || r.right > box.right) el.scrollLeft += r.left - box.left - 16;
  }, [current]);
  return (
    <nav
      ref={nav}
      aria-label="Support"
      className="-mx-4 flex gap-x-5 overflow-x-auto whitespace-nowrap px-4 text-sm [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      data-testid="support-nav"
    >
      {links.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={current === href ? "page" : undefined}
          className={`shrink-0 border-b-2 py-2 ${current === href ? "border-primary font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
