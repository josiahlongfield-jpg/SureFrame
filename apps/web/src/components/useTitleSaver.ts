"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long typing pauses before a title is saved. */
const PAUSE_MS = 800;

const clean = (t: string) => t.replace(/\s+/g, " ").trim();

/**
 * Saves a video's title as it's typed (after a short pause), straight away on
 * `flush` (Enter, leaving the box), and when the page is left or hidden, so a
 * typed title is never lost by navigating away (O52, O64). A save started as
 * the page goes uses `keepalive`, so the browser finishes it after the page
 * has gone. Never saves an empty title; `saved` is the title the server has.
 */
export function useTitleSaver(videoId: string, initial: string, onSaved?: (title: string) => void) {
  const saved = useRef(initial);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string>();
  const shown = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const after = useRef(onSaved);
  after.current = onSaved;

  const send = useCallback(
    async (leaving = false) => {
      clearTimeout(timer.current);
      const typed = pending.current;
      pending.current = null;
      if (typed === null) return;
      const next = clean(typed);
      if (!next || next === saved.current) return;
      const request = fetch(`/api/videos/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
        keepalive: leaving,
      });
      if (leaving) {
        // The page is going: nothing here will be shown again.
        saved.current = next;
        void request.catch(() => {});
        return;
      }
      setState("saving");
      setError(undefined);
      const res = await request.catch(() => null);
      if (!res?.ok) {
        // Kept, so leaving the page or the next pause tries again.
        if (pending.current === null) pending.current = typed;
        setState("idle");
        return setError((await res?.json().catch(() => ({})))?.error ?? "Couldn't save the title. Check your connection; it's saved when you're back online.");
      }
      saved.current = next;
      setState("saved");
      after.current?.(next);
      clearTimeout(shown.current);
      shown.current = setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 2500);
    },
    [videoId],
  );

  /** The box changed: saved once typing pauses. */
  const change = useCallback(
    (title: string) => {
      pending.current = title;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void send(), PAUSE_MS);
    },
    [send],
  );

  /** Save now (Enter, or leaving the box). */
  const flush = useCallback(() => send(), [send]);

  // Leaving the page, hiding it (switching apps on a phone) or moving to another page in the app: save what's typed.
  useEffect(() => {
    const leave = () => void send(true);
    const hidden = () => document.visibilityState === "hidden" && leave();
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
      leave();
    };
  }, [send]);

  /** Another part of the page saved a title: this one is now the saved one. */
  const adopt = useCallback((title: string) => {
    pending.current = null;
    clearTimeout(timer.current);
    saved.current = title;
  }, []);

  return { change, flush, adopt, state, error, saved };
}
