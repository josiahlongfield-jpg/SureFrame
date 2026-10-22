"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HelpPage } from "@/lib/support/clientHelp";

/**
 * A business whose link this device (or this email link) has, and the proof the help chat checks. `limits` is how
 * many questions the panel says can be asked (lib/support/clientHelp.ts); `reply` is the video whose reply box the
 * "Reply to …" button opens, and who it's to, where the client can reply from here.
 */
export type HelpFor = { clientId: string; business: string; s?: string; limits?: string; reply?: { videoId: string; to: string } };

/** WatchView listens for this and opens its reply box (the sheet on a phone), as its own "Reply to …" button does. */
export const OPEN_REPLY_EVENT = "sureframe:open-reply";
type Turn = { role: "client" | "assistant"; text: string; answered?: boolean };

/** Where the panel opens: a slot ClientHeader renders under its top bar, so it pushes the page down rather than covering it. */
const SLOT = "client-help-slot";
const CANT_HELP = "I can't help with that one.";
const stored = (key: string): Turn[] => {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.slice(-20) : [];
  } catch {
    return [];
  }
};

/**
 * Help for clients: a Help button in the client top bar that opens a small AI help chat about these pages. It's
 * separate from SupportChat (the business's help) and never reaches SureFrame's team: when it can't help, it
 * names the business. The conversation stays in this tab; nothing about videos or replies is sent.
 */
export default function ClientHelp({ for: businesses, page, videoId }: { for: HelpFor[]; page: HelpPage; videoId?: string }) {
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [which, setWhich] = useState(0);
  const about = businesses[Math.min(which, businesses.length - 1)];
  const key = `sureframe.clienthelp.${about?.clientId}`;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Refused for a while (a limit): when each business's chat can be used again. Ask stays off until then.
  const [blocked, setBlocked] = useState<Record<string, number>>({});
  const [, setTick] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => setSlot(document.getElementById(SLOT)), []);
  // This page's reply box is there (not a "can't open" card in its place), so the "Reply to …" button can open it.
  const [replyHere, setReplyHere] = useState(false);
  useEffect(() => {
    if (open) setReplyHere(!!document.querySelector("[data-testid=reply-composer]"));
  }, [open]);
  useEffect(() => setTurns(stored(key)), [key]);

  // Escape closes it and puts focus back on the Help button; opening puts the cursor in the question box.
  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);

  // Braces: newer Chrome returns a Promise from scrollIntoView (see SupportChat).
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "nearest" });
  }, [open, turns.length, busy]);

  const until = about ? blocked[about.clientId] : undefined;
  const refused = !!until && until > Date.now();
  // Ask comes back on its own once the limit resets.
  useEffect(() => {
    if (!until) return;
    const wait = until - Date.now();
    if (wait <= 0) return;
    const t = setTimeout(() => (setTick((n) => n + 1), setError(undefined)), Math.min(wait + 500, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [until]);

  if (!about) return null;

  /** Closes help and opens the reply box: on this video's page straight away, otherwise on the video's page. */
  function replyToBusiness() {
    const target = about.reply;
    if (!target) return;
    setOpen(false);
    if (target.videoId === videoId) window.dispatchEvent(new Event(OPEN_REPLY_EVENT));
    else window.location.assign(`/v/${target.videoId}#reply`);
  }
  const replyButton = about.reply && (about.reply.videoId !== videoId || replyHere) && (
    <button
      type="button"
      onClick={replyToBusiness}
      data-testid="client-help-reply"
      className="mt-1.5 rounded-lg border border-primary bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-primary-soft"
    >
      Reply to {about.reply.to}
    </button>
  );

  async function ask(question: string) {
    if (!question.trim() || busy || refused) return;
    const before = turns;
    const asked = [...before, { role: "client" as const, text: question.trim() }];
    setTurns(asked);
    setText("");
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/client-help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: about.clientId,
          s: about.s,
          page,
          videoId,
          // A few recent turns for context. An answer it couldn't give goes back as just that, without the business's address.
          messages: asked.slice(-9).map((t) => ({ role: t.role, text: t.role === "assistant" && !t.answered ? CANT_HELP : t.text })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429 && data.retryAt) {
        const at = new Date(data.retryAt).getTime();
        setBlocked((b) => ({ ...b, [about.clientId]: at }));
        throw new Error([data.error, againAt(at), data.contact].filter(Boolean).join(" "));
      }
      if (!res.ok) throw new Error(data.error ?? "That didn't go through. Please try again.");
      const next = [...asked, { role: "assistant" as const, text: String(data.reply), answered: !!data.answered }];
      setTurns(next);
      try {
        sessionStorage.setItem(key, JSON.stringify(next.slice(-20)));
      } catch {}
    } catch (e) {
      setError((e as Error).message);
      setText(question);
      setTurns(before);
    } finally {
      setBusy(false);
    }
  }

  const panel = (
    <section id={panelId} aria-label="Help" data-testid="client-help-panel" className="pb-4" translate="no">
      <div className="flex max-h-[min(32rem,70vh)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm sm:ml-auto sm:max-w-md">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <p className="font-semibold text-ink">Help</p>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              button.current?.focus();
            }}
            aria-label="Close help"
            className="rounded-lg px-2 py-1 text-dim hover:bg-hover hover:text-ink"
          >
            ✕
          </button>
        </div>
        {businesses.length > 1 && (
          <label className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm text-muted">
            <span>About videos from</span>
            <select value={which} onChange={(e) => setWhich(Number(e.target.value))} className="min-w-0 max-w-full rounded-lg border border-line-strong bg-surface px-2 py-1 text-ink">
              {businesses.map((b, i) => (
                <option key={b.clientId} value={i}>{b.business}</option>
              ))}
            </select>
          </label>
        )}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" data-testid="client-help-messages">
          {/* Promises only what it can do (C17): the Reply button where there's a reply box to open, else contacting them. */}
          <Bubble
            mine={false}
            text={
              replyButton
                ? `Hi! Ask me how to watch, reply or use these pages. I can't answer questions about ${about.business} itself, like its services or appointments. For those, I'll give you a button to reply to ${about.business}.`
                : `Hi! Ask me how to watch, reply or use these pages. I can't answer questions about ${about.business} itself, like its services or appointments. For those, please contact ${about.business} directly.`
            }
          />
          {turns.map((t, i) => (
            <div key={i}>
              <Bubble mine={t.role === "client"} text={t.text} />
              {/* An answer it couldn't give (or an error) ends with the way to reach the business: their reply box. */}
              {t.role === "assistant" && !t.answered && replyButton}
            </div>
          ))}
          {busy && <p className="text-sm text-dim">Thinking…</p>}
          <div ref={end} />
        </div>
        <form
          className="border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={box}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  ask(text);
                }
              }}
              rows={2}
              maxLength={1000}
              data-gramm="false"
              placeholder="Type your question…"
              aria-label="Your question"
              className="min-h-[2.75rem] min-w-0 flex-1 resize-none rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
            />
            <button disabled={busy || refused || !text.trim()} data-testid="client-help-ask" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
              Ask
            </button>
          </div>
          {error && (
            <div className="mt-2">
              <p role="alert" className="text-sm text-danger-fg" data-testid="client-help-error">
                {error}
              </p>
              {replyButton}
            </div>
          )}
          {about.limits && (
            <p className="mt-2 text-xs text-dim" data-testid="client-help-limits">
              {about.limits}
            </p>
          )}
          <p className="mt-2 text-xs leading-4 text-dim">
            Answers come from an AI assistant and can be wrong. It can&apos;t see your videos or replies, and nobody reads this chat, so don&apos;t type anything private.{" "}
            <a href="/legal/privacy#for-clients" className="underline hover:text-muted">Privacy</a>
          </p>
        </form>
      </div>
    </section>
  );

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid="client-help-button"
        className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted hover:text-ink"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" />
        </svg>
        Help
      </button>
      {open && slot && createPortal(panel, slot)}
    </>
  );
}

/** When a refused question can be asked again, in the reader's own clock: "in 7 minutes", or "from Oct 23, 3:24 PM". */
function againAt(at: number) {
  const mins = Math.max(1, Math.ceil((at - Date.now()) / 60_000));
  if (mins <= 60) return `You can ask again in ${mins} ${mins === 1 ? "minute" : "minutes"}.`;
  return `You can ask again from ${new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`;
}

function Bubble({ mine, text }: { mine: boolean; text: string }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm [overflow-wrap:anywhere] ${mine ? "bg-primary text-on-primary" : "bg-surface-2 text-ink"}`}>{text}</div>
    </div>
  );
}
