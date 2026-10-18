"use client";

import { useEffect, useRef, useState } from "react";
import LogoMark from "./LogoMark";

/** Seconds before the intro can be skipped. */
const WAIT_SECONDS = 3;

/** Remembered per business on this device, so a client sees the intro once, not on every video or visit. */
export const introSeenKey = (workspaceId: string) => `sureframe:intro-seen:${workspaceId}`;

/**
 * Shown once per device to clients of businesses on the Free plan, before their first video from that
 * business. It leads with who sent the video; SureFrame's own line is a small credit underneath. It is
 * drawn on the page: no trackers, nothing leaves the page. Paid plans never show it. Only rendered once
 * the video has unlocked, so it never covers a page that can't open.
 */
export default function SureFramePromo({ workspaceId, business, onWatch }: { workspaceId: string; business: string; onWatch: () => void }) {
  // Unknown until this device's storage is checked, so a returning viewer never sees it flash.
  const [open, setOpen] = useState<boolean | null>(null);
  const [left, setLeft] = useState(WAIT_SECONDS);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let seen = false;
    try {
      seen = !!localStorage.getItem(introSeenKey(workspaceId));
    } catch {}
    setOpen(!seen);
  }, [workspaceId]);

  useEffect(() => {
    if (!open || left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [open, left]);

  // The keyboard starts in the card, and lands on Watch now once it can be pressed.
  useEffect(() => {
    if (!open) return;
    const inCard = box.current?.contains(document.activeElement) && document.activeElement !== box.current;
    if (inCard) return;
    if (left > 0) box.current?.focus();
    else button.current?.focus();
  }, [open, left]);

  if (!open) return null;
  const watch = () => {
    try {
      localStorage.setItem(introSeenKey(workspaceId), "1");
    } catch {
      /* storage blocked: it may show again next visit */
    }
    setOpen(false);
    onWatch();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="promo-title"
      aria-describedby="promo-wait"
      data-testid="sureframe-promo"
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-solid/70 px-4 py-6"
      onKeyDown={(e) => {
        // Tab stays in the card: the page behind it isn't usable until the intro closes.
        if (e.key !== "Tab") return;
        const stops = [...(box.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]") ?? [])];
        if (!stops.length) return e.preventDefault();
        const i = stops.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : i === stops.length - 1 ? 0 : i + 1;
        e.preventDefault();
        stops[next].focus();
      }}
    >
      <style>{PROMO_CSS}</style>
      <div ref={box} tabIndex={-1} data-theme="navy" className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface text-center text-ink shadow-2xl outline-none">
        {/* A short animation drawn on the page: no video file, nothing loaded from elsewhere. */}
        <div className="sf-promo relative aspect-[2/1] overflow-hidden bg-gradient-to-br from-[#0f2747] via-[#0f2747] to-[#173357]" aria-hidden="true">
          <div className="sf-s2 absolute inset-0 flex items-center justify-center gap-4 px-6">
            <div className="relative h-20 w-32 rounded-lg bg-gradient-to-br from-[#ff8a7d] to-[#e85d4f] shadow-lg">
              <span className="absolute inset-0 grid place-items-center text-white/90">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
              </span>
              <span className="sf-lock absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-emerald-500 text-white shadow">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0v4" /></svg>
              </span>
            </div>
            <div className="grid gap-2 text-left">
              <span className="sf-b1 rounded-2xl rounded-bl-sm bg-white/15 px-3 py-1.5 text-xs text-white">Here&apos;s your update</span>
              <span className="sf-b2 rounded-2xl rounded-br-sm bg-[#ff6f61] px-3 py-1.5 text-xs text-[#0f2747]">Thanks, looks great!</span>
            </div>
          </div>
        </div>
        <div className="p-6">
          <h2 id="promo-title" className="text-xl font-semibold leading-snug text-ink [overflow-wrap:anywhere] [text-wrap:balance]" data-testid="promo-sender">
            {business} sent you a private video
          </h2>
          <p className="mt-2 text-sm text-muted">Watch it, then reply with a message, a voice note or a video. Only you and {business} can see your conversation.</p>
          <button
            ref={button}
            onClick={watch}
            disabled={left > 0}
            className="mt-5 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-hover disabled:bg-line-strong disabled:text-muted"
          >
            Watch now
          </button>
          {/* A countdown on a greyed-out button reads like a fault, so the short wait is said in words. */}
          <p id="promo-wait" className="mt-2 text-xs text-muted" data-testid="promo-wait">
            {left > 0 ? `You can start watching in ${left} ${left === 1 ? "second" : "seconds"}. ` : ""}This short intro only shows once on this device.
          </p>
          <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-dim">
            <LogoMark size={14} tone="mono" />
            <span>
              Made with SureFrame.{" "}
              <a href="/?ref=promo" target="_blank" rel="noopener" className="font-medium text-accent hover:underline">Try it free</a>
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

/** The animation: a private video arrives, locks, and gets a reply. */
const PROMO_CSS = `
.sf-promo .sf-s2 { animation: sf-in 0.6s ease both; }
.sf-promo .sf-lock { animation: sf-pop 0.6s ease 0.6s both; }
.sf-promo .sf-b1 { animation: sf-rise 0.7s ease 1s both; }
.sf-promo .sf-b2 { animation: sf-rise 0.7s ease 1.9s both; }
@keyframes sf-in { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: none; } }
@keyframes sf-pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: none; } }
@keyframes sf-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .sf-promo * { animation: none !important; }
}
`;
