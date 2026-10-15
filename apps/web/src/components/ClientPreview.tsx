"use client";

import ClientHeader from "./ClientHeader";
import MadeWith from "./MadeWith";
import { brandStyle, type Brand } from "@/lib/branding";
import { newVideoEmail } from "@/lib/newVideoEmail";
import { REACTIONS } from "@/lib/reactions";

export type PreviewView = "video" | "inbox" | "email";

/** Sample content for the branding preview. Nothing here is a real client or video. */
const CLIENT = "Client A";
const TITLE = "Weekly check-in";
const today = () => new Date().toLocaleDateString("en-US", { dateStyle: "medium" });

/**
 * What a client sees, with a business's branding: their video page, their
 * inbox and the email that tells them a video is waiting. Built from the same
 * header, credit, colour tokens and email template as the real thing; shown
 * at real phone and desktop widths by the branding settings page (in an
 * iframe, so the page's own breakpoints apply).
 */
export default function ClientPreview({ brand, view, sender, origin }: { brand: Brand; view: PreviewView; sender: string; origin: string }) {
  // Same rule as the real pages (lib/branding brandOf + BrandMark): nothing set means plain SureFrame.
  const shown = brand.logoUrl || brand.color ? brand : null;
  if (view === "email") return <EmailPreview brand={brand} sender={sender} origin={origin} />;
  return (
    <div data-theme="light" className="min-h-screen bg-canvas text-ink" style={brandStyle(brand.color)} data-testid={`preview-${view}`}>
      {view === "video" ? (
        <>
          <ClientHeader brand={shown} width="max-w-6xl" allVideosLink />
          <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
            <VideoPage business={brand.name} sender={sender} />
          </main>
        </>
      ) : (
        <>
          <ClientHeader brand={shown} />
          <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
            <InboxPage business={brand.name} sender={sender} />
          </main>
        </>
      )}
      <MadeWith />
    </div>
  );
}

function VideoPage({ business, sender }: { business: string; sender: string }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <section>
        <div className="relative overflow-hidden rounded-2xl bg-black shadow-sm">
          <div className="grid aspect-video place-items-center bg-gradient-to-br from-slate-700 to-slate-900">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-surface/90 text-ink shadow-lg">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-8 text-xs text-white/90">
            <span>0:00 / 3:12</span>
            <span className="h-1 flex-1 rounded-full bg-surface/30"><span className="block h-1 w-1/4 rounded-full bg-surface" /></span>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <h1 className="text-2xl font-semibold text-ink">{TITLE}</h1>
            <p className="mt-1 px-1 text-sm text-dim">
              {sender} from {business} · {today()} · 2 views
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          {REACTIONS.map((e) => (
            <span key={e} className="rounded-full border border-line bg-surface px-3 py-1.5 text-lg">{e}</span>
          ))}
        </div>
      </section>

      <aside className="flex max-h-[80vh] flex-col self-start rounded-2xl border border-line bg-surface lg:max-h-none">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold text-ink">Conversation</h2>
            <p className="text-xs text-dim">Reply with a video, a voice note or a message. End-to-end encrypted.</p>
          </div>
        </div>
        <ul className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <Bubble who={sender} fromOwner text="Here's this week's plan. Watch from 1:05 for the new part." at="0:00" />
          <Bubble who={CLIENT} text="Thanks! Got it. I'll send a video of my first try tomorrow." />
        </ul>
        <div className="border-t border-line p-4">
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1 text-sm">
            {["Text", "Video", "Voice"].map((t, i) => (
              <span key={t} className={`rounded-md px-2 py-1.5 text-center font-medium ${i === 0 ? "bg-surface text-ink shadow-sm" : "text-muted"}`}>{t}</span>
            ))}
          </div>
          <div className="w-full rounded-lg border border-primary px-3 py-2 text-sm text-ink" style={{ minHeight: "4.5rem" }}>
            Sounds good, see you Thursday
          </div>
          <span className="mt-2 block w-full rounded-lg bg-solid px-3 py-2.5 text-center text-sm font-semibold text-white">Send reply</span>
        </div>
      </aside>
    </div>
  );
}

function Bubble({ who, text, fromOwner = false, at }: { who: string; text: string; fromOwner?: boolean; at?: string }) {
  return (
    <li className={`flex flex-col ${fromOwner ? "items-start" : "items-end"}`}>
      <div className="mb-1 flex items-center gap-2 text-xs text-dim">
        <span className="font-medium text-ink">{who}</span>
        <span>{fromOwner ? "9:41 AM" : "10:02 AM"}</span>
      </div>
      <div className={`max-w-[90%] rounded-2xl px-3 py-2 ${fromOwner ? "rounded-tl-sm bg-surface-2 text-ink" : "rounded-tr-sm bg-primary text-white"}`}>
        {at && <span className={`mr-1.5 rounded px-1.5 text-xs font-medium ${fromOwner ? "bg-surface text-accent" : "bg-surface/20 text-white"}`}>{at}</span>}
        <span className="whitespace-pre-wrap">{text}</span>
      </div>
    </li>
  );
}

function InboxPage({ business, sender }: { business: string; sender: string }) {
  const videos = [
    { title: TITLE, ago: 0 },
    { title: "Week 2 check-in", ago: 7 },
    { title: "Welcome and first steps", ago: 14 },
  ];
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your videos</h1>
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-dim">From {business}</h2>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
          {videos.map((v) => (
            <li key={v.title} className="flex items-center justify-between px-5 py-4">
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{v.title}</span>
                <span className="block text-xs text-dim">{sender} from {business}</span>
              </span>
              <span className="shrink-0 pl-3 text-sm text-dim">{new Date(Date.now() - v.ago * 86_400_000).toLocaleDateString("en-US", { dateStyle: "medium" })}</span>
            </li>
          ))}
        </ul>
        <section className="mt-4 rounded-2xl border border-line bg-surface p-5">
          <h2 className="font-semibold text-ink">Your to-dos &amp; notes</h2>
          <ul className="mt-2 divide-y divide-line">
            {["Practise the new routine 3 times", "Send a video of your first try"].map((t, i) => (
              <li key={t} className="flex items-start gap-3 py-2.5">
                <input type="checkbox" readOnly checked={i === 0} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
                <p className={`text-sm ${i === 0 ? "text-dim line-through" : "text-ink"}`}>{t}</p>
              </li>
            ))}
          </ul>
        </section>
        <p className="mt-2 text-xs text-dim">
          Reminder emails to client-a@example.com are on. <span className="font-medium text-accent">Turn off</span>
        </p>
      </section>
    </>
  );
}

function EmailPreview({ brand, sender, origin }: { brand: Brand; sender: string; origin: string }) {
  // Emails need absolute addresses; an unsaved logo is a data: URL already.
  const logoUrl = brand.logoUrl && brand.logoUrl.startsWith("/") ? origin + brand.logoUrl : brand.logoUrl;
  const mail = newVideoEmail({ business: brand.name, sender, clientName: CLIENT, link: `${origin}/inbox`, logoUrl, color: brand.color });
  return (
    <div data-theme="light" className="min-h-screen bg-surface-2 p-3 text-ink sm:p-8" data-testid="preview-email">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="border-b border-line px-5 py-4">
          <p className="text-lg font-semibold text-ink" data-testid="email-subject">{mail.subject}</p>
          <div className="mt-2 flex items-center gap-3 text-sm">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-line-strong font-semibold text-muted">{brand.name.trim().charAt(0).toUpperCase()}</span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink">{brand.name}</span>
              <span className="block text-xs text-dim">to client-a@example.com</span>
            </span>
          </div>
        </div>
        {/* The real email HTML, isolated from the app's styles like a mail app would. */}
        <iframe title="Email body" srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:0">${mail.html}</body>`} sandbox="allow-same-origin" className="h-[22rem] w-full" />
      </div>
    </div>
  );
}
