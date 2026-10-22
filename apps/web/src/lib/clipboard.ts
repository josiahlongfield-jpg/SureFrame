"use client";

import { useEffect, useState } from "react";

/**
 * Copies text worked out after a click. Safari only lets a page write to the
 * clipboard during the click itself, so the text goes in as a promise.
 */
export async function writeClipboard(text: Promise<string> | string) {
  if (typeof text === "string") {
    // Some in-app and older browsers have no clipboard API, or refuse it: the old copy command still works there.
    if (!navigator.clipboard?.writeText) return legacyCopy(text);
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  }
  const pending = Promise.resolve(text);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": pending.then((t) => new Blob([t], { type: "text/plain" })) })]);
      return;
    } catch {
      /* older browsers: plain text below */
    }
  }
  const t = await pending;
  if (!navigator.clipboard?.writeText) return legacyCopy(t);
  await navigator.clipboard.writeText(t).catch(() => legacyCopy(t));
}

/** Copies with the browser's old copy command, through a hidden text box. Throws when the browser refuses. */
function legacyCopy(text: string) {
  const was = document.activeElement as HTMLElement | null;
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
  document.body.appendChild(box);
  box.select();
  box.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    /* refused */
  }
  box.remove();
  was?.focus?.();
  if (!ok) throw new Error("Couldn't copy");
}

/** Phones and tablets with a share sheet get a Share button next to Copy link. */
export function useCanShare() {
  const [can, setCan] = useState(false);
  useEffect(() => setCan(typeof navigator.share === "function" && matchMedia("(pointer: coarse)").matches), []);
  return can;
}

/** Opens the share sheet; false when it was closed without sharing. */
export async function shareLink(url: string, title: string) {
  try {
    await navigator.share({ title, url });
    return true;
  } catch {
    return false;
  }
}
