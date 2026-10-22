"use client";

import { useEffect, useState } from "react";

/** "Open all answers" / "Close all answers" for the FAQ page's questions, for people who'd rather read them all (V29). */
export default function FaqExpandAll() {
  const [allOpen, setAllOpen] = useState(false);
  useEffect(() => {
    const items = () => [...document.querySelectorAll<HTMLDetailsElement>("details[data-testid=faq-item]")];
    const sync = () => setAllOpen(items().length > 0 && items().every((d) => d.open));
    sync();
    // details' toggle event doesn't bubble, so it's listened for in the capture phase.
    document.addEventListener("toggle", sync, true);
    return () => document.removeEventListener("toggle", sync, true);
  }, []);
  return (
    <button
      type="button"
      onClick={() => {
        const open = !allOpen;
        document.querySelectorAll<HTMLDetailsElement>("details[data-testid=faq-item]").forEach((d) => (d.open = open));
        setAllOpen(open);
      }}
      className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover"
      data-testid="faq-expand-all"
    >
      {allOpen ? "Close all answers" : "Open all answers"}
    </button>
  );
}
