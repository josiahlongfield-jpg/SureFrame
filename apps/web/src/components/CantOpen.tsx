import type { ReactNode } from "react";

/**
 * The one "can't open" card every client-facing dead end uses (a video this device can't unlock, a link
 * that doesn't look right, one that's ended, a private address), so they all look and read the same:
 * what happened, what to do, and the one action that helps. Clients have no accounts, so signing in is
 * only ever a small link for the business.
 */
export default function CantOpen({
  title,
  children,
  action,
  signInNext,
  testId,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  /** Adds "Are you the business? Sign in", returning here. */
  signInNext?: string;
  testId?: string;
}) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-6 text-center sm:p-10" data-testid={testId ?? "cant-open"}>
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-muted" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
      </span>
      <h1 className="mt-4 text-lg font-semibold text-ink [text-wrap:balance]" data-testid="cant-open-title">{title}</h1>
      <div className="mt-2 space-y-2 text-sm text-muted">{children}</div>
      {action && <div className="mt-5">{action}</div>}
      {signInNext && (
        <p className="mt-6 text-xs text-dim">
          Are you the business?{" "}
          <a href={`/login?next=${encodeURIComponent(signInNext)}`} className="font-medium text-accent hover:underline">Sign in</a>
        </p>
      )}
    </div>
  );
}
