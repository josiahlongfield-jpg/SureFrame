"use client";

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { reportClientError } from "@/lib/clientError";
import { REPLY_WITHIN, TALK_TO_PERSON } from "@/lib/support/person";

type Message = { id: string; author: "CUSTOMER" | "ASSISTANT" | "STAFF"; body: string; at: string };
type Ticket = { status: "OPEN" | "NEEDS_HUMAN" | "ANSWERED" | "CLOSED"; hasEmail?: boolean; messages: Message[] };

const KEY = "sureframe.support";
const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const save = (t: string | null) => {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {}
};

const WELCOME = `Hi! I'm SureFrame's assistant. Ask me anything about recording, clients, billing or your account. Or press Talk to a person: someone from the team replies ${REPLY_WITHIN}.`;

/** The support conversation: the AI assistant first, a person when needed. */
export function SupportChat({ signedIn, className = "" }: { signedIn: boolean; className?: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // "Talk to a person" from a visitor with no email yet: asked for one, so the reply can reach them by email.
  const [askEmail, setAskEmail] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const emailBox = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (t: string, background = false) => {
    const res = await fetch("/api/support", { headers: { "x-support-token": t, ...(background ? { "x-sf-background": "1" } : {}) } });
    // Gone, or a signed-in customer's conversation and they aren't the one signed in here (a shared computer).
    if (res.status === 404 || res.status === 403) {
      save(null);
      setToken(null);
      setTicket(null);
      if (res.status === 403) setError("That conversation belongs to an account. Sign in to it to see the conversation, or ask a new question here.");
      return;
    }
    if (res.ok) setTicket(await res.json());
  }, []);

  useEffect(() => {
    // A link from a support email carries the conversation in the #fragment.
    const fromLink = new URLSearchParams(location.hash.slice(1)).get("t");
    if (fromLink) {
      save(fromLink);
      history.replaceState(null, "", location.pathname + location.search);
    }
    const t = fromLink ?? read();
    if (t) {
      setToken(t);
      refresh(t);
    }
  }, [refresh]);

  // While a person is involved, check for their reply now and then.
  useEffect(() => {
    if (!token || !ticket || ticket.status === "OPEN") return;
    const id = setInterval(() => refresh(token, true), 20000);
    return () => clearInterval(id);
  }, [token, ticket, refresh]);

  // Braces matter: newer Chrome returns a Promise from scrollIntoView, which
  // React would otherwise try to call as the effect's cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [ticket?.messages.length, busy]);

  async function send(body: string, person = false) {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    setAskEmail(false);
    const optimistic: Message = { id: "pending", author: "CUSTOMER", body, at: new Date().toISOString() };
    setTicket((t) => ({ status: t?.status ?? "OPEN", hasEmail: t?.hasEmail, messages: [...(t?.messages ?? []), optimistic] }));
    setText("");
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token ?? undefined, body, email: !signedIn && email ? email : undefined, ...(person ? { person: true } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't send that. Please try again.");
      save(data.token);
      setToken(data.token);
      setTicket({ status: data.status, hasEmail: data.hasEmail, messages: data.messages });
    } catch (e) {
      setError((e as Error).message);
      setText(body);
      setTicket((t) => (t ? { ...t, messages: t.messages.filter((m) => m.id !== "pending") } : t));
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    save(null);
    setToken(null);
    setTicket(null);
    setError(undefined);
    setAskEmail(false);
  }

  /**
   * Hands the conversation to a person straight away (not left to the assistant): it joins the support inbox's
   * "Needs you" list and the team is emailed. Anything typed in the box goes with it.
   */
  function talkToPerson() {
    // A visitor's reply goes by email, so one is needed first (the server checks too).
    if (!signedIn && !ticket?.hasEmail && !email.trim()) {
      setAskEmail(true);
      emailBox.current?.focus();
      return;
    }
    send(text.trim() || TALK_TO_PERSON, true);
  }

  const withPerson = ticket && ticket.status !== "OPEN";
  // Asked until there's an address on the conversation, so a person's reply can reach them by email.
  const needsEmail = !signedIn && !ticket?.hasEmail;

  return (
    <div className={`flex min-h-0 flex-col ${className}`} translate="no">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        <Bubble author="ASSISTANT" body={WELCOME} />
        {ticket?.messages.map((m) => <Bubble key={m.id} author={m.author} body={m.body} />)}
        {busy && <p className="text-sm text-dim">Thinking…</p>}
        {withPerson && (
          <p role="status" className="rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="with-person">
            {ticket.status === "ANSWERED" ? (
              "The SureFrame team has replied"
            ) : (
              <>
                <span className="font-semibold">Passed to a person:</span> we reply {REPLY_WITHIN}
              </>
            )}
            {signedIn || ticket.hasEmail ? ", here and by email." : ", here in this chat. Add your email below to get the reply by email too."}
          </p>
        )}
        <div ref={end} />
      </div>
      <form
        className="border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        {needsEmail && (
          <label className="mb-2 grid gap-1">
            <span id="help-email-note" className={`text-xs ${askEmail ? "font-medium text-ink" : "text-dim"}`}>
              {askEmail ? "Where should a person reply? Add your email, then press Talk to a person again." : "Your email (optional), for a reply by email"}
            </span>
            <input
              ref={emailBox}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Your email"
              aria-describedby="help-email-note"
              data-gramm="false"
              className={`w-full rounded-lg border px-3 py-2 text-sm ${askEmail ? "border-accent ring-2 ring-accent/30" : "border-line-strong"}`}
            />
          </label>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            rows={2}
            maxLength={4000}
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            placeholder="Type your question…"
            aria-label="Your message"
            className="min-h-[2.75rem] flex-1 resize-none rounded-lg border border-line-strong px-3 py-2 text-sm"
          />
          <button disabled={busy || !text.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
            Send
          </button>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-danger-fg">{error}</p>}
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
          {!withPerson ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button type="button" onClick={() => talkToPerson()} disabled={busy} data-testid="talk-to-person"
                className="rounded-lg border border-line-strong px-3 py-1.5 font-medium text-ink hover:bg-hover disabled:opacity-50">
                Talk to a person
              </button>
            </span>
          ) : (
            <span />
          )}
          {ticket && (
            <button type="button" onClick={startOver} data-testid="new-conversation" className="rounded-lg border border-line-strong px-3 py-1.5 font-medium text-ink hover:bg-hover">
              New conversation
            </button>
          )}
        </div>
        <p className="mt-2 text-[0.6875rem] text-dim">
          Answers come from an AI assistant and can be wrong. Never share your recovery key, password or card details.{" "}
          <a href="/legal/privacy" className="underline hover:text-muted">Privacy</a>
        </p>
      </form>
    </div>
  );
}

function Bubble({ author, body }: { author: Message["author"]; body: string }) {
  const mine = author === "CUSTOMER";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-on-primary" : author === "STAFF" ? "border border-ok-line bg-ok-bg text-ink" : "bg-surface-2 text-ink"}`}>
        {author === "STAFF" && <p className="mb-1 text-xs font-semibold text-ok-fg">SureFrame team</p>}
        {body}
      </div>
    </div>
  );
}


/**
 * Keeps a problem inside the chat (a browser extension rewriting the text box,
 * say) from taking the whole page down with it.
 */
export class ChatBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    reportClientError("support-chat", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex flex-1 flex-col items-start gap-3 p-4 text-sm text-muted" role="alert">
        <p>The chat hit a problem in this browser. A browser extension that edits text boxes can cause this.</p>
        <button onClick={() => this.setState({ failed: false })} className="rounded-lg bg-primary px-3 py-2 font-semibold text-on-primary hover:bg-primary-hover">
          Try again
        </button>
        <a href="/help" className="text-accent hover:underline">Open the help page instead</a>
      </div>
    );
  }
}

/** Opens the help panel from elsewhere on the page (the app's phone menu has a Help item). */
export const OPEN_HELP_EVENT = "sf:open-help";
export const openHelp = () => window.dispatchEvent(new Event(OPEN_HELP_EVENT));

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A Help button that opens the chat in a panel. On computers it's fixed to the corner. On phones it sits
 * at the very end of the page, in room kept free for it, so it never covers the page's own buttons or text
 * (the app's phone menu has a Help item too). The open panel holds the keyboard until Escape or ✕ closes it.
 */
export default function SupportWidget({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    // Back to what opened it; the phone menu's Help item has gone with the menu, so then the Help button (shown
    // again by then). No scrolling: on a phone the button is at the end of the page.
    requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : button.current)?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    setMounted(true);
    window.addEventListener(OPEN_HELP_EVENT, show);
    return () => window.removeEventListener(OPEN_HELP_EVENT, show);
  }, [show]);

  // Escape closes the chat.
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, close]);

  // Opening moves focus into the panel: the question box with a mouse and keyboard; the panel itself on a
  // touch screen, so the on-screen keyboard doesn't jump up over the conversation.
  useEffect(() => {
    if (!open) return;
    const box = panel.current;
    const field = matchMedia("(pointer: fine)").matches ? box?.querySelector<HTMLElement>("textarea") : null;
    (field ?? box)?.focus();
  }, [open]);

  // On phones the page keeps room at its end for the button, which is placed there (see the portal below).
  useEffect(() => {
    document.body.classList.add("max-sm:pb-20", "max-sm:relative");
    return () => document.body.classList.remove("max-sm:pb-20", "max-sm:relative");
  }, []);

  // Tab and Shift+Tab go round the panel's own controls.
  function trap(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !panel.current) return;
    const els = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-label="SureFrame help"
          tabIndex={-1}
          onKeyDown={trap}
          className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl outline-none sm:inset-auto sm:bottom-5 sm:right-6 sm:h-[70vh] sm:max-h-[37.5rem] sm:w-[23.75rem]"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-semibold text-ink">SureFrame help</p>
            <button onClick={close} aria-label="Close help" className="rounded-lg px-2 text-dim hover:text-ink">
              ✕
            </button>
          </div>
          <ChatBoundary>
            <SupportChat signedIn={signedIn} className="flex-1" />
          </ChatBoundary>
        </div>
      )}
      {/* A small round button on phones (the word on wider screens). Not shown while the panel is open: ✕ closes it. */}
      {mounted &&
        !open &&
        createPortal(
          <button
            ref={button}
            onClick={show}
            aria-expanded={open}
            aria-label="Help"
            data-testid="help-button"
            className="absolute bottom-4 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-line-strong bg-solid text-sm font-semibold text-on-solid shadow-lg hover:bg-solid-hover sm:fixed sm:bottom-5 sm:right-6 sm:z-50 sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-3"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
            <span className="max-sm:sr-only">Help</span>
          </button>,
          document.body,
        )}
    </>
  );
}
