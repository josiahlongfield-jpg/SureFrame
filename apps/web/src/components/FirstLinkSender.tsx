"use client";

import { useState } from "react";
import { useCanShare, writeClipboard } from "@/lib/clipboard";
import { firstLinkMessage, mailtoFor } from "@/lib/firstLink";

type How = "link" | "message" | "share" | "email";

/** A key: the personal link. 16px unless the class gives a size. */
export const KeyIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${/\bh-\d/.test(className) ? "" : "h-4 w-4"} ${className}`}>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m10.7 12.3 9.3-9.3M16 7l3 3M14 9l2 2" />
  </svg>
);

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
  disabled,
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
  disabled?: boolean;
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
  const main = compact
    ? "rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
    : "rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50";
  const off = disabled || !!busy;

  return (
    <div data-testid="first-link-sender">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={off}
          className={main}
          data-testid="first-link-copy"
          onClick={() => run("link", () => writeClipboard(getLink()), `${name}'s link is copied. Paste it into a text, chat or email to them. It only opens for ${name}.`)}
        >
          {busy === "link" ? "Copying…" : done?.how === "link" && !done.error ? "Link copied" : copyLabel}
        </button>
        <button
          type="button"
          disabled={off}
          className={btn}
          data-testid="first-link-message"
          onClick={() => run("message", () => writeClipboard(message().then((m) => m.body)), `Copied the link with a short note that tells ${name} what it is. Paste it into a text, chat or email to them.`)}
        >
          {busy === "message" ? "Copying…" : done?.how === "message" && !done.error ? "Copied" : "Copy link + message"}
        </button>
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
        {email && (
          <button
            type="button"
            disabled={off}
            className={btn}
            data-testid="first-link-email"
            onClick={() =>
              run(
                "email",
                async () => {
                  // A link clicked for them: the device's email app opens, and this page stays.
                  const a = document.createElement("a");
                  a.href = mailtoFor(email, await message());
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                },
                "Your email app should open with the message ready to send. Nothing opened? Use Copy link + message and paste it into an email.",
              )
            }
          >
            Email from my email
          </button>
        )}
      </div>
      {done && (
        <p role={done.error ? "alert" : "status"} data-testid="first-link-done" className={`mt-1.5 text-xs ${done.error ? "text-danger-fg" : "text-ok-fg"}`}>
          {done.text}
        </p>
      )}
    </div>
  );
}

/**
 * Why a client needs their personal link, in three steps: shown wherever a
 * business or staff member could otherwise miss it (adding clients, sending a
 * first video, the start of the library). `skipAdd` leaves out "Add the
 * client", for staff who can't add clients.
 */
export function PersonalLinkSteps({ className = "", compact, skipAdd }: { className?: string; compact?: boolean; skipAdd?: boolean }) {
  const steps = [
    ...(skipAdd ? [] : [{ title: "Add the client", body: "Their name, and their email if you have it." }]),
    { title: "Send them their personal link, once", body: "Copy it and send it by text, chat or your own email. Their videos only open after they've opened this link.", key: true },
    { title: "Then just send videos", body: "Pick them and press Send by email, or copy the video's link. It opens straight away for them." },
  ];
  return (
    <div className={`rounded-xl border-2 border-primary bg-primary-soft p-4 text-sm text-ink ${className}`} data-testid="personal-link-steps">
      <p className="flex items-center gap-2 font-semibold">
        <KeyIcon />
        How clients get their videos
      </p>
      <ol className={`mt-3 grid gap-2 ${compact ? "" : skipAdd ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        {steps.map((s, i) => (
          <li key={s.title} className={`flex gap-2.5 rounded-lg bg-surface p-3 ${"key" in s ? "ring-2 ring-primary" : ""}`}>
            <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary font-mono text-xs font-semibold text-on-primary">{i + 1}</span>
            <span>
              <span className="block font-medium">{s.title}</span>
              <span className="mt-0.5 block text-xs text-muted">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer font-medium text-accent">Why can&apos;t SureFrame email the first link?</summary>
        <p className="mt-1">
          Your videos are end-to-end encrypted. Each client&apos;s personal link holds the key to their videos, and only your team&apos;s devices have it, so we couldn&apos;t
          email it without being able to see their videos. Once they&apos;ve opened it, their phone or computer remembers it, and every video you send opens there.
        </p>
      </details>
    </div>
  );
}
