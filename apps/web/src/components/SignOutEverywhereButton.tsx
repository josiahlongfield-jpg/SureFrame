"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * "Sign out everywhere" (Settings > Account > This device; Decision 8, 22 October 2026): for a lost phone or a
 * shared computer left signed in. Asks once more first, since it signs this browser out too.
 */
export default function SignOutEverywhereButton() {
  const { pending } = useFormStatus();
  const [sure, setSure] = useState(false);
  return !sure ? (
    <button
      type="button"
      onClick={() => setSure(true)}
      data-testid="sign-out-everywhere"
      className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover"
    >
      Sign out everywhere
    </button>
  ) : (
    <div role="alertdialog" aria-label="Sign out everywhere?" className="rounded-xl border border-line-strong bg-surface-2 p-4 text-sm text-ink" data-testid="sign-out-everywhere-confirm">
      <p className="font-semibold">Sign out on every device?</p>
      <p className="mt-1 text-muted">
        Every phone, computer and browser signed in to your account is signed out, this one included. You can sign in again straight away. Your videos, clients and
        recovery key don&apos;t change. A connected Claude stays connected until you disconnect it on Connections.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={pending} autoFocus className="rounded-xl bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60" data-testid="sign-out-everywhere-yes">
          {pending ? "Signing out…" : "Yes, sign out everywhere"}
        </button>
        <button type="button" disabled={pending} onClick={() => setSure(false)} className="rounded-xl border border-line-strong bg-surface px-4 py-2 font-medium text-ink hover:bg-hover">
          Cancel
        </button>
      </div>
    </div>
  );
}
