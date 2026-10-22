"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { DELETION_GRACE_DAYS } from "@/lib/periods";

/**
 * The confirm box and button for closing the account: the button works once
 * the email is typed, then asks once more before anything happens, and shows
 * that closing is under way, since it can take a few seconds.
 */
export default function DeleteAccountButton({ email }: { email: string }) {
  const { pending } = useFormStatus();
  const [typed, setTyped] = useState("");
  const [sure, setSure] = useState(false);
  const matches = typed.trim().toLowerCase() === email.toLowerCase();
  return (
    <>
      <label className="block text-sm text-muted">
        Type <span className="font-semibold">{email}</span> to confirm
        <input
          name="confirm"
          type="email"
          autoComplete="off"
          required
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setSure(false);
          }}
          className="mt-1 block w-full rounded-xl border border-line-strong px-3 py-2 text-sm"
        />
      </label>
      {!sure ? (
        <button
          type="button"
          disabled={!matches}
          onClick={() => setSure(true)}
          data-testid="delete-account"
          // Until the email matches: red writing in a grey outline, so it never reads as the coral of Save.
          className="rounded-xl border border-red-600 bg-red-600 px-4 py-2 text-sm font-semibold text-white enabled:hover:bg-red-700 disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-surface disabled:text-danger-fg"
        >
          Delete my account
        </button>
      ) : (
        <div role="alertdialog" aria-label="Delete your account?" className="rounded-xl border border-danger-line bg-danger-bg p-4 text-sm text-danger-fg" data-testid="delete-account-confirm">
          <p className="font-semibold">Delete your account now?</p>
          <p className="mt-1">You&apos;re signed out everywhere straight away. You can still keep it by signing in within {DELETION_GRACE_DAYS} days.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={pending} className="rounded-xl bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 disabled:opacity-60" data-testid="delete-account-yes">
              {pending ? "Closing your account…" : "Yes, delete my account"}
            </button>
            <button type="button" disabled={pending} onClick={() => setSure(false)} className="rounded-xl border border-line-strong bg-surface px-4 py-2 font-medium text-ink hover:bg-hover">
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
