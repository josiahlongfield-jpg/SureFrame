"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Links = readonly (readonly [string, string])[];

const isCurrent = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/** Menu links with the current page in bold, and others bold while hovered. A hidden bold copy reserves the width so nothing shifts. */
export default function NavLinks({ links, className }: { links: Links; className: string }) {
  const path = usePathname() ?? "";
  return links.map(([href, label]) => {
    const current = isCurrent(path, href);
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

/** One "Settings" item on wider screens that opens the settings pages in a small menu. */
export function SettingsMenu({ links }: { links: Links }) {
  const path = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = links.some(([href]) => isCurrent(path, href));

  // Close on navigation, on a click outside and on Escape.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="settings-menu"
        data-testid="settings-menu-button"
        className={`group flex items-center gap-1 ${current ? "text-ink" : "text-muted hover:text-ink"}`}
      >
        <span className="inline-grid">
          <span aria-hidden className="invisible col-start-1 row-start-1 font-semibold">Settings</span>
          <span className={`col-start-1 row-start-1 ${current ? "font-semibold" : "group-hover:font-semibold"}`}>Settings</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`transition ${open ? "rotate-180" : ""}`}>
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id="settings-menu" className="absolute left-0 top-full z-50 mt-3 grid w-52 rounded-xl border border-line bg-surface p-1.5 shadow-lg" data-testid="settings-menu">
          <NavLinks links={links} className="rounded-lg px-3 py-2 hover:bg-hover" />
        </div>
      )}
    </div>
  );
}
