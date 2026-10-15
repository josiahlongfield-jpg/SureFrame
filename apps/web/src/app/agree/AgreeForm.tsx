"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

function Submit({ ticked }: { ticked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={!ticked || pending}
      data-testid="agree-submit"
      className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-8"
    >
      {pending ? "Saving…" : "Agree"}
    </button>
  );
}

/** The box starts unticked and the button stays off until it's ticked; the server checks the box again. */
export default function AgreeForm({ action, next }: { action: (form: FormData) => Promise<void>; next: string }) {
  const [ticked, setTicked] = useState(false);
  return (
    <form action={action} className="mt-6 grid gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 text-ink">
        <input
          type="checkbox"
          name="agree"
          required
          checked={ticked}
          onChange={(e) => setTicked(e.target.checked)}
          data-testid="agree-checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
        />
        <span>I have read and agree to the Terms of Service and Privacy Policy</span>
      </label>
      <Submit ticked={ticked} />
    </form>
  );
}
