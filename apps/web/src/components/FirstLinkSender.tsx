"use client";

import { useState } from "react";
import { useCanShare, writeClipboard } from "@/lib/clipboard";
import { firstLinkMessage, mailtoFor } from "@/lib/firstLink";

type How = "link" | "message" | "share" | "email";

/**
 * The ways a business sends a client their personal link: the bare link, the
 * link with a short note for the client, the phone's share sheet, or its own
 * email app filled in. `getLink` may do the sending first (SendPanel), so each
 * button waits for it.
 */
export default function FirstLinkSender({
  name,
  email,
  business,
  video,
  getLink,
  onSent,
  compact,
  alignEnd,
  disabled,
  plain,
  short,
  inline,
  copyLabel = "Copy link",
}: {
  name: string;
  email?: string | null;
  business: string;
  /** The link opens a video, not just their page. */
  video?: boolean;
  getLink: () => Promise<string>;
  onSent?: (how: How) => void;
  /** Buttons only, for a row in a list. */
  compact?: boolean;
  /** Buttons line up from the right (in a row of controls on the right), on screens wider than a phone. */
  alignEnd?: boolean;
  disabled?: boolean;
  /** No button stands out: sending it again, from a row that's already sent. */
  plain?: boolean;
  /** Leaves out Copy link + message, for a row with little room. */
  short?: boolean;
  /** Buttons only, sitting among a row's other buttons; what happened is said by the row and its panel. */
  inline?: boolean;
  copyLabel?: string;
}) {
  const canShare = useCanShare();
  const [busy, setBusy] = useState<How | null>(null);
  const [done, setDone] = useState<{ how: How; text: string; error?: boolean }>();
  const message = async () => firstLinkMessage({ name, business, link: await getLink(), video, email: !!email });

  async function run(how: How, act: () => Promise<boolean | void>, text: string) {
    setBusy(how);
    setDone(undefined);
    try {
      if ((await act()) === false) return;
      setDone({ how, text });
      onSent?.(how);
    } catch (err) {
      setDone({ how, error: true, text: (err as Error)?.message || "That didn't work. Try again." });
    } finally {
      setBusy(null);
    }
  }

  const btn = compact
    ? "rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-hover disabled:opacity-50"
    : "rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50";
  const main = plain
    ? btn
    : compact
    ? "rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
    : "rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50";
  const off = disabled || !!busy;

  // A first video: the business's own email app comes first, filled in for them, or with the To line
  // left for them to fill when no address is saved.
  const emailFirst = !!video;
  const emailButton = (email || video) && (
    <button
      type="button"
      disabled={off}
      className={emailFirst ? main : btn}
      data-testid="first-link-email"
      onClick={() =>
        run(
          "email",
          async () => {
            // A link clicked for them: the device's email app opens, and this page stays.
            const a = document.createElement("a");
            a.href = mailtoFor(email ?? "", await message());
            document.body.appendChild(a);
            a.click();
            a.remove();
          },
          email
            ? "Your email app should open with the message ready to send. Nothing opened? Use Copy link + message and paste it into an email."
            : `Your email app should open with the message ready: add ${name}'s email address and send. Nothing opened? Use Copy link + message and paste it into an email.`,
        )
      }
    >
      Send from my email
    </button>
  );

  return (
    <div data-testid="first-link-sender" className={inline ? "contents" : undefined}>
      <div className={`flex flex-wrap gap-1.5 ${alignEnd ? "sm:justify-end" : ""}`}>
        {emailFirst && emailButton}
        <button
          type="button"
          disabled={off}
          className={emailFirst ? btn : main}
          data-testid="first-link-copy"
          onClick={() => run("link", () => writeClipboard(getLink()), `${name}'s link is copied. Paste it into a text, chat or email to them. It only opens for ${name}.`)}
        >
          {busy === "link" ? "Copying…" : done?.how === "link" && !done.error ? "Link copied" : copyLabel}
        </button>
        {!short && <button
          type="button"
          disabled={off}
          className={btn}
          data-testid="first-link-message"
          onClick={() => run("message", () => writeClipboard(message().then((m) => m.body)), `Copied the link with a short note that tells ${name} what it is. Paste it into a text, chat or email to them.`)}
        >
          {busy === "message" ? "Copying…" : done?.how === "message" && !done.error ? "Copied" : "Copy link + message"}
        </button>}
        {canShare && (
          <button
            type="button"
            disabled={off}
            className={btn}
            data-testid="first-link-share"
            onClick={() =>
              run(
                "share",
                async () => {
                  const m = await message();
                  try {
                    await navigator.share({ title: m.subject, text: m.body });
                    return true;
                  } catch {
                    return false;
                  }
                },
                `Shared with a short note that tells ${name} what the link is.`,
              )
            }
          >
            Share
          </button>
        )}
        {!emailFirst && emailButton}
      </div>
      {done && (!inline || done.error) && (
        <p role={done.error ? "alert" : "status"} data-testid="first-link-done" className={`mt-1.5 text-xs ${done.error ? "text-danger-fg" : "text-ok-fg"} ${alignEnd ? "sm:ml-auto sm:max-w-sm sm:text-right" : ""}`}>
          {done.text}
        </p>
      )}
    </div>
  );
}

/**
 * How clients get videos, in three steps: shown wherever a business or staff
 * member is starting out (adding clients, sending a first video, the start of
 * the library). `skipAdd` leaves out "Add the client", for staff who can't add clients.
 */
export function PersonalLinkSteps({ className = "", compact, skipAdd }: { className?: string; compact?: boolean; skipAdd?: boolean }) {
  const steps = [
    ...(skipAdd ? [] : [{ title: "Add the client", body: "Name, and email if you have it." }]),
    { title: "Send their first video yourself", body: "From your email, or copy the link. They just open it and watch." },
    { title: "After that, we email them", body: "Press Send by email for every video after the first." },
  ];
  return (
    <div className={`rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink ${className}`} data-testid="personal-link-steps">
      <p className="font-semibold">
        How clients get your videos
      </p>
      <ol className={`mt-3 grid gap-2 ${compact ? "" : skipAdd ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-2.5 rounded-lg bg-surface p-3">
            <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary font-mono text-xs font-semibold text-on-primary">{i + 1}</span>
            <span>
              <span className="block font-medium">{s.title}</span>
              <span className="mt-0.5 block text-xs text-muted">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer font-medium text-accent">Why does the first video come from me?</summary>
        <p className="mt-1">
          Your videos are end-to-end encrypted. The link to a client&apos;s first video also carries the key to all their videos, and only your team&apos;s devices have it,
          so we couldn&apos;t email it without being able to see their videos. Once they&apos;ve opened it, their phone or computer remembers it, and every video you send
          opens there.
        </p>
      </details>
    </div>
  );
}
