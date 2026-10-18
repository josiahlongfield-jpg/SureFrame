"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HelpPage } from "@/lib/support/clientHelp";

/** A business whose link this device (or this email link) has, and the proof the help chat checks. */
export type HelpFor = { clientId: string; business: string; s?: string };
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
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => setSlot(document.getElementById(SLOT)), []);
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

  if (!about) return null;

  async function ask(question: string) {
    if (!question.trim() || busy) return;
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
          <Bubble mine={false} text={`Hi! Ask me how to watch, reply or use these pages. For anything about ${about.business} itself, I'll tell you how to reach them.`} />
          {turns.map((t, i) => (
            <Bubble key={i} mine={t.role === "client"} text={t.text} />
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
            <button disabled={busy || !text.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
              Ask
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger-fg">
              {error}
            </p>
          )}
          <p className="mt-2 text-[0.6875rem] leading-4 text-dim">
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

function Bubble({ mine, text }: { mine: boolean; text: string }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm [overflow-wrap:anywhere] ${mine ? "bg-primary text-on-primary" : "bg-surface-2 text-ink"}`}>{text}</div>
    </div>
  );
}
