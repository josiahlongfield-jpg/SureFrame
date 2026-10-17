"use client";

import { useEffect, useState } from "react";

/**
 * Copies text worked out after a click. Safari only lets a page write to the
 * clipboard during the click itself, so the text goes in as a promise.
 */
export async function writeClipboard(text: Promise<string> | string) {
  if (typeof text === "string") return navigator.clipboard.writeText(text);
  const pending = Promise.resolve(text);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": pending.then((t) => new Blob([t], { type: "text/plain" })) })]);
      return;
    } catch {
      /* older browsers: plain text below */
    }
  }
  await navigator.clipboard.writeText(await pending);
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
