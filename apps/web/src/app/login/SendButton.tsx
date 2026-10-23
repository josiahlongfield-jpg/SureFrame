"use client";

import { useFormStatus } from "react-dom";

/**
 * The sign-in page's send button. Sending the email can take a few seconds, so while it's on its way the button says
 * so and can't be pressed again: before, nothing seemed to happen, and each extra press sent another email and queued
 * behind the first, so the page was slow to move on to the check page (Josiah, 23 October 2026).
 */
export default function SendButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      aria-busy={pending}
      data-testid="send-link"
      className="rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary hover:bg-primary-hover disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? busy : label}
    </button>
  );
}
