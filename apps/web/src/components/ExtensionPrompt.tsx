"use client";

import { useEffect, useState } from "react";

/** The extension's page in the browser's store, once it's published (Edge can have its own, from Edge Add-ons). */
const CHROME_URL = process.env.NEXT_PUBLIC_EXTENSION_URL;
const EDGE_URL = process.env.NEXT_PUBLIC_EXTENSION_URL_EDGE;
const SKIP_KEY = "sureframe.extensionPrompt";

const isEdge = () => typeof navigator !== "undefined" && /\bEdg\//.test(navigator.userAgent);

/** Where to get the extension in this browser. */
export function extensionUrl() {
  if (isEdge() && EDGE_URL) return EDGE_URL;
  return CHROME_URL;
}

/** Whether the person chose "Don't ask again" in this browser. */
export function extensionPromptSkipped() {
  try {
    return localStorage.getItem(SKIP_KEY) === "skip";
  } catch {
    return false;
  }
}

/**
 * Shown on pressing Start for a screen recording in a browser the extension is for, while it isn't added yet: what
 * the extension does, why it's safe, and a way to add it or carry on without it. Once the extension says hello (it
 * can be added while this is open), it offers to start.
 */
export default function ExtensionPrompt({
  installed,
  cameraOn = true,
  onStart,
  onCancel,
}: {
  installed: boolean;
  /** Screen + Camera; Screen only has no camera bubble, just Pause and Stop. */
  cameraOn?: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const [skip, setSkip] = useState(false);
  const [opened, setOpened] = useState(false);
  const url = extensionUrl();
  const store = url && /microsoftedge\.microsoft\.com/.test(url) ? "Edge Add-ons" : "the Chrome Web Store";
  // Edge installs from the Chrome Web Store once the person allows other stores there.
  const edgeFromChrome = isEdge() && store === "the Chrome Web Store";

  useEffect(() => {
    const keys = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [onCancel]);

  function withoutIt() {
    if (skip) {
      try {
        localStorage.setItem(SKIP_KEY, "skip");
      } catch {}
    }
    onStart();
  }

  if (installed) {
    return (
      <section className="grid gap-3 rounded-2xl border border-ok-line bg-ok-bg p-4" data-testid="extension-prompt" aria-live="polite">
        <h2 className="text-base font-semibold text-ok-fg">SureFrame extension added</h2>
        <p className="text-sm text-ink">
          {cameraOn ? "Your camera bubble, with Pause and Stop, will follow you to every tab while you record." : "Pause and Stop will follow you to every tab while you record."}
        </p>
        <button onClick={onStart} className="rounded-xl bg-primary px-4 py-3 font-semibold text-on-primary shadow-sm hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          Start recording
        </button>
      </section>
    );
  }

  return (
    <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm" data-testid="extension-prompt" aria-labelledby="extension-prompt-title">
      <h2 id="extension-prompt-title" className="text-base font-semibold text-ink">
        Add the free SureFrame extension first?
      </h2>
      <p className="text-sm text-muted">
        {cameraOn
          ? "It shows your camera bubble, with Pause and Stop, on any tab you visit while you record your screen. Without it, your bubble stays in a small floating window instead."
          : "It shows Pause and Stop on any tab you visit while you record your screen. Without it, they stay in a small floating window instead."}
      </p>
      <div className="grid gap-1.5 rounded-xl bg-surface-2 p-3 text-sm text-muted" data-testid="extension-safe">
        <p className="font-medium text-ink">Why it&rsquo;s safe</p>
        <ul className="grid list-disc gap-1 pl-5">
          <li>It comes from {store}, made by SureFrame.</li>
          <li>It only shows your camera and recording controls, and only while you&rsquo;re recording with SureFrame.</li>
          <li>
            The extension itself doesn&rsquo;t read, collect or send anything from the websites you visit. Your recording is made by this tab, and only shows
            what you choose to share, the same as without it.
          </li>
          <li>You can remove it any time from your browser&rsquo;s extensions page.</li>
        </ul>
      </div>
      {edgeFromChrome && (
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted" data-testid="extension-edge-note">
          <span className="font-medium text-ink">Using Microsoft Edge?</span> It installs from the Chrome Web Store. On that page, click{" "}
          <span className="font-medium text-ink">Allow extensions from other stores</span> at the top, then <span className="font-medium text-ink">Add to Chrome</span>, which adds it to Edge.
        </p>
      )}
      {opened && (
        <p className="text-sm text-muted" data-testid="extension-waiting" aria-live="polite">
          Once you&rsquo;ve clicked Add in the store, come back to this tab. It notices straight away, no reload needed.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener"
          onClick={() => setOpened(true)}
          className="min-w-[10rem] flex-1 rounded-xl bg-primary px-4 py-3 text-center font-semibold text-on-primary shadow-sm hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-testid="extension-add"
        >
          Add the free extension
        </a>
        <button onClick={withoutIt} className="min-w-[10rem] flex-1 rounded-xl border border-line-strong px-4 py-3 font-medium text-ink hover:bg-hover" data-testid="extension-skip">
          Record without it
        </button>
      </div>
      {/* Plainly a tick box that goes with Record without it, not a third choice among the buttons (O60). */}
      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2 text-sm text-muted">
        <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" data-testid="extension-dont-ask" />
        <span>
          Don&rsquo;t ask me again in this browser
          <span className="block text-xs text-dim">Takes effect when you press Record without it.</span>
        </span>
      </label>
      <button onClick={onCancel} className="justify-self-start text-sm font-medium text-muted underline underline-offset-2 hover:text-ink">
        Back
      </button>
    </section>
  );
}
