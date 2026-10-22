"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

const WAIT = 30;

/** "Send again", once a short wait after sending is over, so a slow email isn't chased with several more. */
export default function SendAgain({ since = 0 }: { since?: number }) {
  // Counted from when the email was sent, so reloading the page doesn't start the wait again (O97).
  const [left, setLeft] = useState(Math.max(0, WAIT - since));
  const { pending } = useFormStatus();
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return (
    <button
      disabled={left > 0 || pending}
      data-testid="send-again"
      className="w-full rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Sending…" : left > 0 ? `Send again in ${left}s` : "Send again"}
    </button>
  );
}
