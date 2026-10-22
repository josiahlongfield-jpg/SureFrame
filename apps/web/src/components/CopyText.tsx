"use client";

import { useState } from "react";
import { writeClipboard } from "@/lib/clipboard";

/** A button that copies some text, and says so for a moment. */
export default function CopyText({ text, label, testId }: { text: string; label: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await writeClipboard(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm hover:bg-hover"
      data-testid={testId}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
