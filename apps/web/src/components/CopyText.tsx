"use client";

import { useState } from "react";
import { writeClipboard } from "@/lib/clipboard";

/** A button that copies some text, and says so for a moment. */
export default function CopyText({ text, label, testId }: { text: string; label: string; testId?: string }) {
  // "failed" when the browser refuses the clipboard: said on the button for a moment, never "Copied".
  const [state, setState] = useState<"copied" | "failed" | null>(null);
  const said = state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy. Try again." : null;
  return (
    <>
    <button
      type="button"
      onClick={async () => {
        const ok = await writeClipboard(text).then(() => true, () => false);
        setState(ok ? "copied" : "failed");
        setTimeout(() => setState(null), ok ? 2000 : 4000);
      }}
      className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm hover:bg-hover"
      data-testid={testId}
    >
      {said ?? label}
    </button>
    {/* Read out as well as shown: a button's changed text isn't announced by every screen reader. Takes no room. */}
    <span role="status" className="sr-only">{said}</span>
    </>
  );
}
