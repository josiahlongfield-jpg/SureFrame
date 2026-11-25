import { useEffect, useRef } from "react";

/**
 * Links inside the app (the header's Library, Clients, Settings and so on) change the page without closing the
 * tab, so the browser's own "Leave site?" question never shows for them. While `active` (a recording is under way),
 * a click on one is held back and `onLeave` is given where it was going, so the page can ask first. Links that open
 * a new tab, go to another site (the browser asks about those itself) or stay on this page are left alone.
 */
export function useLeaveGuard(active: boolean, onLeave: (href: string) => void) {
  const ask = useRef(onLeave);
  useEffect(() => {
    ask.current = onLeave;
  });
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      if (a.origin !== window.location.origin) return;
      if (a.pathname === window.location.pathname && a.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      ask.current(a.pathname + a.search + a.hash);
    };
    // On the window, before anything on the page sees the click, so the app's own links don't act on it.
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [active]);
}
