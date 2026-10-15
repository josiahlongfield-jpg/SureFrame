"use client";

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { reportClientError } from "@/lib/clientError";

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

const WELCOME = "Hi! I'm SureFrame's assistant. Ask me anything about recording, clients, billing or your account. I can pass you to a person whenever you'd like.";

/** The support conversation: the AI assistant first, a person when needed. */
export function SupportChat({ signedIn, className = "" }: { signedIn: boolean; className?: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const end = useRef<HTMLDivElement>(null);

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

  async function send(body: string) {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    const optimistic: Message = { id: "pending", author: "CUSTOMER", body, at: new Date().toISOString() };
    setTicket((t) => ({ status: t?.status ?? "OPEN", hasEmail: t?.hasEmail, messages: [...(t?.messages ?? []), optimistic] }));
    setText("");
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token ?? undefined, body, email: !signedIn && email ? email : undefined }),
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
          <p className="rounded-xl bg-warn-bg p-3 text-xs text-warn-fg" data-testid="with-person">
            {ticket.status === "ANSWERED" ? "The SureFrame team has replied." : "A person from the SureFrame team will reply"}
            {signedIn || ticket.hasEmail ? " here and by email." : " here. Add your email below to get the reply by email too."}
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
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Your email (so we can reply)"
            aria-label="Your email"
            data-gramm="false"
            className="mb-2 w-full rounded-lg border border-line-strong px-3 py-2 text-sm"
          />
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
        <div className="mt-2 flex justify-between text-xs text-dim">
          {!withPerson ? (
            <button type="button" onClick={() => send("I'd like to talk to a person, please.")} disabled={busy} className="hover:text-ink">
              Talk to a person
            </button>
          ) : (
            <span />
          )}
          {ticket && (
            <button type="button" onClick={startOver} className="hover:text-ink">
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

/** A Help button fixed to the corner that opens the chat in a panel. */
export default function SupportWidget({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && (
        <div role="dialog" aria-label="SureFrame help" className="fixed inset-x-3 bottom-20 z-50 flex h-[70vh] max-h-[37.5rem] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl sm:inset-x-auto sm:right-6 sm:w-[23.75rem]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-semibold text-ink">SureFrame help</p>
            <button onClick={() => setOpen(false)} aria-label="Close help" className="rounded-lg px-2 text-dim hover:text-ink">
              ✕
            </button>
          </div>
          <ChatBoundary>
            <SupportChat signedIn={signedIn} className="flex-1" />
          </ChatBoundary>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border border-line-strong bg-solid px-4 py-3 text-sm font-semibold text-on-solid shadow-lg backdrop-blur-md hover:bg-solid-hover sm:right-6"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
        Help
      </button>
    </>
  );
}
