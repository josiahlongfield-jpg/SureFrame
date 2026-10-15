"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import NavLinks from "./NavLinks";

/** The app menu on phones and small screens: one Menu button that opens every link in a tidy list. */
export default function MobileMenu({ links, plan, email, signOut }: { links: readonly (readonly [string, string])[]; plan: string; email: string; signOut: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const box = useRef<HTMLDivElement>(null);

  // Close on navigation, on a tap outside and on Escape.
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
    <div ref={box} className="xl:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="app-menu"
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 font-medium text-muted hover:bg-hover"
        data-testid="menu-button"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="text-dim">
          {open ? (
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          ) : (
            <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          )}
        </svg>
        Menu
      </button>
      {open && (
        <div id="app-menu" className="absolute inset-x-0 top-full z-40 border-b border-line bg-surface shadow-lg" data-testid="app-menu">
          {/* Any link closes the menu, the current page's too (that one doesn't change the path). */}
          <nav onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)} className="mx-auto flex max-w-6xl flex-col px-2 py-2 text-base sm:px-4">
            <NavLinks links={links} className="rounded-lg px-3 py-2.5 hover:bg-hover" />
          </nav>
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm sm:px-7">
            <span className="min-w-0 truncate text-dim">
              <span className="mr-2 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">{plan}</span>
              {email}
            </span>
            {signOut}
          </div>
        </div>
      )}
    </div>
  );
}
