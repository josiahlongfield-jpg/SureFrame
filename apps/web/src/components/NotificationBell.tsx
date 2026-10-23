"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
// A browser "visit": gone when the browser closes, and cleared on sign-in and sign-out (lib/activity.ts).
import { BELL_VISIT_COOKIE as VISIT_COOKIE } from "@/lib/activity";

type Item = { id: string; kind: string; text: string; href: string; createdAt: string; read: boolean };

/** Fired by pages that mark notifications read (a conversation opened), so the bell updates straight away. */
export const NOTIFICATIONS_CHANGED = "sf:notifications";
/** How often an open page checks for new ones. */
const CHECK_MS = 30_000;

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86_400) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/**
 * The bell in the top menu (Josiah, 23 October 2026): a red dot while there's something unread, and a list of the
 * latest (lib/notifications.ts). It shakes when a new one arrives while the site is open, and on the first page after
 * signing in or reopening the browser while anything is unread. Not on every page in between.
 */
export default function NotificationBell({ initialUnread, initialNewest }: { initialUnread: number; initialNewest: string | null }) {
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shaking, setShaking] = useState(false);
  // The newest unread one already known about: anything newer makes it shake.
  const known = useRef(initialNewest);
  const box = useRef<HTMLDivElement>(null);
  const path = usePathname();

  const stop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shake = useCallback(() => {
    setShaking(false);
    requestAnimationFrame(() => setShaking(true));
    // Also when the animation never runs (motion turned off, a hidden tab).
    if (stop.current) clearTimeout(stop.current);
    stop.current = setTimeout(() => setShaking(false), 3500);
  }, []);

  const take = useCallback(
    (data: { unread: number; newest: string | null }) => {
      setUnread(data.unread);
      if (data.newest && (!known.current || data.newest > known.current)) {
        known.current = data.newest;
        shake();
      }
    },
    [shake],
  );

  // The first page of a visit: shake if anything's waiting.
  useEffect(() => {
    if (document.cookie.split("; ").some((c) => c === `${VISIT_COOKIE}=1`)) return;
    document.cookie = `${VISIT_COOKIE}=1; path=/; SameSite=Lax`;
    if (initialUnread > 0) shake();
  }, [initialUnread, shake]);

  // Checks for new ones while the page is open (and visible), without counting as using the site (src/middleware.ts).
  const check = useCallback(async () => {
    const res = await fetch("/api/notifications?count=1", { headers: { "x-sf-background": "1" } }).catch(() => null);
    if (res?.ok) take(await res.json());
  }, [take]);
  useEffect(() => {
    const t = setInterval(() => !document.hidden && void check(), CHECK_MS);
    const visible = () => !document.hidden && void check();
    const changed = () => void check();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener(NOTIFICATIONS_CHANGED, changed);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener(NOTIFICATIONS_CHANGED, changed);
    };
  }, [check]);

  async function load() {
    setFailed(false);
    const res = await fetch("/api/notifications").catch(() => null);
    if (!res?.ok) return setFailed(true);
    const data = (await res.json()) as { items: Item[]; unread: number; newest: string | null };
    setItems(data.items);
    take(data);
  }

  async function markRead(body: { id: string } | { all: true }) {
    setItems((cur) => cur?.map((i) => ("all" in body || i.id === body.id ? { ...i, read: true } : i)) ?? cur);
    const res = await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (res?.ok) take(await res.json());
  }

  // Close on navigation, a tap outside and Escape.
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
    <div ref={box} className={shaking ? "bell-shaking" : undefined}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
        aria-expanded={open}
        aria-controls="bell-list"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        title="Notifications"
        data-testid="bell"
        data-shaking={shaking || undefined}
        className="relative grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={shaking ? "bell-shake" : undefined} onAnimationEnd={() => setShaking(false)}>
          <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" />
          <path d="M10 20.5a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && <span className="bell-dot absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-red-500" data-testid="bell-dot" aria-hidden />}
      </button>
      {open && (
        <div
          id="bell-list"
          role="dialog"
          aria-label="Notifications"
          data-testid="bell-list"
          // Phones: the full width under the bar. Wider screens: a panel under the bell.
          className="fixed inset-x-0 bottom-0 top-16 z-50 flex flex-col border-t border-line bg-surface text-ink shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-full sm:mt-1 sm:max-h-[min(32rem,calc(100dvh-6rem))] sm:w-96 sm:rounded-2xl sm:border"
          data-theme="fresh"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="font-semibold">Notifications</h2>
            {unread > 0 && (
              <button type="button" onClick={() => void markRead({ all: true })} data-testid="bell-read-all" className="text-sm font-medium text-accent hover:underline">
                Mark all as read
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {failed ? (
              <p className="px-4 py-6 text-sm text-dim">
                Couldn&apos;t load your notifications.{" "}
                <button type="button" onClick={() => void load()} className="font-medium text-accent hover:underline">
                  Try again
                </button>
              </p>
            ) : items === null ? (
              <p className="px-4 py-6 text-sm text-dim">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-dim" data-testid="bell-empty">
                Nothing yet. Client replies, reminders and anything else we&apos;d email you about show up here.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={n.href}
                      onClick={() => {
                        if (!n.read) void markRead({ id: n.id });
                        setOpen(false);
                      }}
                      data-testid="bell-item"
                      data-read={n.read || undefined}
                      className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-hover"
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-red-500"}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={`block [overflow-wrap:anywhere] ${n.read ? "text-muted" : "font-medium text-ink"}`} data-testid="bell-text">
                          {n.text}
                        </span>
                        <span className="mt-0.5 block text-xs text-dim">
                          {n.read ? "" : <span className="sr-only">Unread. </span>}
                          {ago(n.createdAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
