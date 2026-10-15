"use client";

import { useEffect, useState } from "react";
import LogoMark, { Wordmark } from "./LogoMark";

const WAIT_SECONDS = 10;

/**
 * Shown to clients of businesses on the Free plan before a video. It is our
 * own short message, not a third-party ad: no trackers, nothing leaves the page.
 * Paid plans never show it.
 */
export default function SureFramePromo({ videoId }: { videoId: string }) {
  const seenKey = `sureframe-promo-${videoId}`;
  // Unknown until we've checked this visit's storage, so a returning viewer never sees it flash.
  const [open, setOpen] = useState<boolean | null>(null);
  const [left, setLeft] = useState(WAIT_SECONDS);

  useEffect(() => {
    let seen = false;
    try {
      seen = !!sessionStorage.getItem(seenKey);
    } catch {}
    setOpen(!seen);
  }, [seenKey]);

  useEffect(() => {
    if (!open || left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [open, left]);

  if (!open) return null;
  const close = () => {
    try {
      sessionStorage.setItem(seenKey, "1");
    } catch {}
    setOpen(false);
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="promo-title" data-testid="sureframe-promo" className="fixed inset-0 z-50 grid place-items-center bg-solid/70 px-4">
      <style>{PROMO_CSS}</style>
      <div data-theme="navy" className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface text-center text-ink shadow-2xl">
        {/* A 10-second animated promo, drawn on the page: no video file, nothing loaded from elsewhere. */}
        <div className="sf-promo relative aspect-video overflow-hidden bg-gradient-to-br from-[#0f2747] via-[#0f2747] to-[#173357]" aria-hidden="true">
          <div className="sf-s1 absolute inset-0 grid place-items-center">
            <div className="flex items-center gap-3 text-2xl text-white">
              <LogoMark size={44} tone="dark" />
              <Wordmark />
            </div>
          </div>
          <div className="sf-s2 absolute inset-0 flex items-center justify-center gap-4 px-6">
            <div className="relative h-24 w-36 rounded-lg bg-gradient-to-br from-[#ff8a7d] to-[#e85d4f] shadow-lg">
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
          <div className="sf-s3 absolute inset-0 grid place-items-center px-8">
            <p className="text-xl font-semibold leading-snug tracking-tight text-white [text-wrap:balance]">
              Private video messages for businesses and their clients.
            </p>
          </div>
          <div className="sf-bar absolute inset-x-0 bottom-0 h-1 origin-left bg-[#ff6f61]" />
        </div>
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Sent with SureFrame</p>
          <h2 id="promo-title" className="sr-only">Private video messages for businesses and their clients</h2>
          <p className="mt-2 text-sm text-muted">
            Record once, send to any number of clients, and get a video, voice or text reply back. Every video is end-to-end encrypted, and clients never pay.
          </p>
          <div className="mt-5 grid gap-3">
            <button
              onClick={close}
              disabled={left > 0}
              className="rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-hover disabled:bg-line-strong disabled:text-muted"
            >
              {left > 0 ? `Watch your video in ${left}` : "Watch your video"}
            </button>
            <a href="/?ref=promo" target="_blank" rel="noopener" className="text-sm font-medium text-accent hover:underline">
              Run a business? Try SureFrame free
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The promo's timeline: logo (0-3.3s), a private video and its reply (2.9-7s), the line (from 6.6s). */
const PROMO_CSS = `
.sf-promo .sf-s1 { animation: sf-in-out 3.3s ease both; }
.sf-promo .sf-s2 { opacity: 0; animation: sf-in-out 4.1s ease 2.9s both; }
.sf-promo .sf-s3 { opacity: 0; animation: sf-in 1.2s ease 6.6s both; }
.sf-promo .sf-lock { animation: sf-pop 0.6s ease 3.6s both; }
.sf-promo .sf-b1 { animation: sf-rise 0.7s ease 4s both; }
.sf-promo .sf-b2 { animation: sf-rise 0.7s ease 4.9s both; }
.sf-promo .sf-bar { animation: sf-bar 10s linear both; }
@keyframes sf-in-out { 0% { opacity: 0; transform: scale(.94); } 20% { opacity: 1; transform: none; } 85% { opacity: 1; } 100% { opacity: 0; } }
@keyframes sf-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes sf-pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: none; } }
@keyframes sf-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes sf-bar { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@media (prefers-reduced-motion: reduce) {
  .sf-promo .sf-s1, .sf-promo .sf-s2 { display: none; }
  .sf-promo .sf-s3 { opacity: 1; animation: none; }
  .sf-promo .sf-bar { animation-duration: 0s; }
}
`;
