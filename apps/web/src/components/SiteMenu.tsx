"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * The public bar's links on the narrowest phones (under 375px), where Pricing and Sign in (or Library) don't fit
 * beside the logo and Start free: one small Menu button that drops them down (R2-V67). Wider screens show the links.
 */
export default function SiteMenu({ links }: { links: readonly (readonly [string, string])[] }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const box = useRef<HTMLDivElement>(null);

  // Close on navigation, on a tap outside and on Escape (focus back on the button).
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      box.current?.querySelector("button")?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative min-[375px]:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label="Menu"
        className="flex items-center rounded-lg px-2 py-2 text-muted hover:text-ink"
        data-testid="site-menu-button"
      >
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
          {open ? (
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          ) : (
            <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          )}
        </svg>
      </button>
      {open && (
        <nav
          id="site-menu"
          aria-label="Site"
          onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}
          className="absolute right-0 top-full z-40 mt-2 flex w-44 flex-col rounded-xl border border-line bg-surface p-1.5 text-base shadow-lg"
          data-testid="site-menu"
        >
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="rounded-lg px-3 py-2.5 text-ink hover:bg-hover">
              {label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
