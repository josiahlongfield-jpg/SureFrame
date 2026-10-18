"use client";

import { useEffect } from "react";

/** Opens the FAQ answer an address points at (/faq#cancel), as links from the Help page expect; a closed one would look like a dead link. */
export default function OpenFaqFromHash() {
  useEffect(() => {
    const open = () => {
      const el = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: "start" });
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
