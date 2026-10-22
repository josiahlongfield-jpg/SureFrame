"use client";

import { useEffect, useState } from "react";

/**
 * A small "Back to contents" button on the long legal pages (V55), shown at the bottom left once the contents list
 * (#contents) has scrolled out of view, so a reader who followed a contents link can pick another section. Bottom left
 * keeps it clear of the floating Help button.
 */
export default function BackToContents() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const toc = document.getElementById("contents");
    if (!toc || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setShow(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    io.observe(toc);
    return () => io.disconnect();
  }, []);
  return (
    <a
      href="#contents"
      data-testid="back-to-contents"
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      className={`fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 z-30 rounded-full border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-ink shadow-lg transition duration-200 hover:bg-canvas sm:bottom-5 sm:left-6 ${
        show ? "opacity-100" : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      <span aria-hidden="true">↑ </span>Contents
    </a>
  );
}
