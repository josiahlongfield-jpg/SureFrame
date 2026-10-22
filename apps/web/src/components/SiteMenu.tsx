"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { openHelp } from "./SupportChat";

/**
 * Help in the public bar on phones 440px to 639px wide, where there's no floating Help button (decision 1): opens the
 * help panel as a sheet, or goes to /help on a page without one. Narrower phones have it in the menu instead.
 */
export function SiteHelp() {
  return (
    <a
      href="/help"
      onClick={(e) => {
        e.preventDefault();
        openHelp();
      }}
      className="hidden whitespace-nowrap rounded-lg px-2 py-2 text-muted hover:text-ink min-[440px]:max-sm:inline"
      data-testid="site-help"
    >
      Help
    </a>
  );
}

/**
 * The public bar's links on phones under 440px, where they don't all fit beside the logo and Start free: one small Menu
 * button that drops them down (R2-V67), with Help after them, since phones have no floating Help button (decision 1).
 * Pricing is in it under 440px; a link marked `narrow` (Sign in or Library) only under 375px, where it leaves the bar
 * too. Wider screens show the links and Help in the bar.
 */
export default function SiteMenu({ links }: { links: readonly (readonly [href: string, label: string, narrow?: boolean])[] }) {
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
    <div ref={box} className="relative min-[440px]:hidden">
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
          {links.map(([href, label, narrow]) => (
            <Link key={href} href={href} className={`rounded-lg px-3 py-2.5 text-ink hover:bg-hover ${narrow ? "min-[375px]:hidden" : ""}`}>
              {label}
            </Link>
          ))}
          <a
            href="/help"
            onClick={(e) => {
              e.preventDefault();
              setOpen(false);
              openHelp();
            }}
            className="rounded-lg px-3 py-2.5 text-ink hover:bg-hover"
            data-testid="site-menu-help"
          >
            Help
          </a>
        </nav>
      )}
    </div>
  );
}
