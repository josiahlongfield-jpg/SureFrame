"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { exportKey, fingerprint as keyFingerprint } from "@/lib/e2e/crypto";
import { loadKey, teamKeyName } from "@/lib/e2e/keystore";
import TeamKeyGate, { KEY_CREATED } from "./TeamKeyGate";
import { BRAND } from "@/lib/brand";
import { writeClipboard } from "@/lib/clipboard";


/** Where the key can be shown again later, said wherever it's shown. */
export const FIND_IT_LATER = "You can show it again any time under Settings > Account (Show recovery key) on a device that's already unlocked.";

const groups = (value: string) => value.match(/.{1,4}/g) ?? [value];

/**
 * The recovery key in groups of four, in a font with a slashed zero and with
 * numbers in colour, so 0 and O (or 1 and l) can't be mixed up. The key
 * itself is unchanged; spaces are ignored when it's typed back in.
 */
export function KeyText({ value, testId, className = "" }: { value: string; testId?: string; className?: string }) {
  return (
    <p className={`break-words rounded-lg bg-surface px-3 py-2 font-mono text-base leading-relaxed tracking-wide text-ink slashed-zero ${className}`} data-recovery-key={value} data-testid={testId}>
      {groups(value).map((g, i) => (
        <span key={i}>
          <span className="inline-block whitespace-nowrap">
            {[...g].map((c, j) => (/\d/.test(c) ? <span key={j} className="font-semibold text-accent">{c}</span> : c))}
          </span>
          {i < groups(value).length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}

const keyFile = (value: string, business: string) =>
  [
    `${BRAND.name} recovery key${business ? ` for ${business}` : ""}`,
    "",
    groups(value).join(" "),
    "",
    "This key opens your end-to-end encrypted videos on a new phone, computer or browser. We can't recover it for you.",
    "Keep it somewhere private, like a password manager. Anyone signed in to your account with it can open your videos.",
    FIND_IT_LATER,
    "",
  ].join("\n");

/** Copy, download as a .txt file, or print. */
export function KeyActions({ value, business, tone = "plain" }: { value: string; business: string; tone?: "plain" | "warn" }) {
  const [copied, setCopied] = useState(false);
  const btn = `rounded-lg border bg-surface px-3 py-1.5 text-sm font-medium ${tone === "warn" ? "border-warn-line text-warn-fg" : "border-line-strong text-ink"} hover:bg-hover`;
  function download() {
    const url = URL.createObjectURL(new Blob([keyFile(value, business)], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "sureframe-recovery-key.txt" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function print() {
    // A hidden frame holding just the key, so the rest of the page isn't printed.
    const frame = Object.assign(document.createElement("iframe"), { title: "Recovery key" });
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
    document.body.append(frame);
    const doc = frame.contentDocument!;
    const pre = doc.createElement("pre");
    pre.style.cssText = "font:16px/1.6 ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:slashed-zero;white-space:pre-wrap";
    pre.textContent = keyFile(value, business);
    doc.body.append(pre);
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 60_000);
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={async () => {
          await writeClipboard(value);
          setCopied(true);
        }}
        className={btn}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <button type="button" onClick={download} className={btn} data-testid="key-download">Download (.txt)</button>
      <button type="button" onClick={print} className={btn}>Print</button>
    </div>
  );
}

/** This device's copy of the team key as a recovery key, if it has the current one. */
function useDeviceKey(workspaceId: string, fingerprint: string | null) {
  const [value, setValue] = useState<string | null>();
  useEffect(() => {
    let cancelled = false;
    const load = async (created: boolean) => {
      const key = await loadKey(teamKeyName(workspaceId));
      // Made on this page (the server's fingerprint is from before), or the business's current key.
      const ok = key && (created || !fingerprint || (await keyFingerprint(key)) === fingerprint);
      if (cancelled) return;
      setValue(ok ? await exportKey(key) : null);
    };
    void load(false);
    const onCreated = (e: Event) => (e as CustomEvent<string>).detail === workspaceId && void load(true);
    window.addEventListener(KEY_CREATED, onCreated);
    return () => {
      cancelled = true;
      window.removeEventListener(KEY_CREATED, onCreated);
    };
  }, [workspaceId, fingerprint]);
  return { value };
}

async function markSaved() {
  await fetch("/api/workspace/key/saved", { method: "POST" }).catch(() => null);
}

/** Says at once that "I've saved it" registered, while the page catches up. */
function SavedNote() {
  return (
    <p role="status" className="rounded-2xl border border-ok-line bg-ok-bg p-4 text-sm text-ok-fg" data-testid="recovery-key-saved">
      Thanks, noted that you&apos;ve saved your recovery key. {FIND_IT_LATER}
    </p>
  );
}

/** The key with everything needed to keep it, and "I've saved it". Used by the header reminder and the first steps. */
export function RecoveryKeyBox({ value, business, onSaved, onLater, titled = true }: { value: string; business: string; onSaved: () => void; onLater?: () => void; /** Off inside the first steps, whose step already says it. */ titled?: boolean }) {
  const [saved, setSaved] = useState(false);
  if (saved) return <SavedNote />;
  return (
    <div role="region" aria-label="Save your recovery key" className="rounded-2xl border border-warn-line bg-warn-bg p-5" data-testid="recovery-key-box">
      {titled && <h2 className="mb-1 font-semibold text-warn-fg">Save your recovery key</h2>}
      <p className="text-sm text-warn-fg">
        Your videos are end-to-end encrypted on this device. You&apos;ll need this key to open them on another computer, phone or browser. We can&apos;t recover it for you, so keep it somewhere private, like a password manager.
      </p>
      <KeyText value={value} className="mt-3" />
      <p className="mt-1 text-xs text-warn-fg">Numbers are in colour, so 0 (zero) and O, or 1 and l, can&apos;t be mixed up. Spaces don&apos;t matter.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <KeyActions value={value} business={business} tone="warn" />
        <button
          type="button"
          onClick={async () => {
            // Answered straight away; the server is told in the background.
            setSaved(true);
            await markSaved();
            onSaved();
          }}
          className="rounded-lg bg-amber-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          I&apos;ve saved it
        </button>
        {onLater && (
          <button type="button" onClick={onLater} className="px-2 py-1.5 text-sm text-warn-fg underline-offset-2 hover:underline" data-testid="recovery-key-later">
            Remind me later
          </button>
        )}
      </div>
      <p className="mt-3 text-xs text-warn-fg">{FIND_IT_LATER}</p>
    </div>
  );
}

/**
 * The first steps' recovery key step: the key from this device, or where to
 * find it when this device doesn't hold it.
 */
export function RecoveryKeyStep({ workspaceId, fingerprint, business }: { workspaceId: string; fingerprint: string | null; business: string }) {
  const router = useRouter();
  const { value } = useDeviceKey(workspaceId, fingerprint);
  const [saved, setSaved] = useState(false);
  if (value === undefined) return null;
  if (saved) return <SavedNote />;
  // A brand-new business has no key yet: this device makes it here (TeamKeyGate), then shows it.
  if (value === null && !fingerprint) {
    return (
      <TeamKeyGate workspaceId={workspaceId} fingerprint={null}>
        {() => <p className="text-sm text-muted">Making your key…</p>}
      </TeamKeyGate>
    );
  }
  if (value === null) {
    return (
      <div className="text-sm text-muted">
        <p>Your recovery key opens your encrypted videos on a new device. This browser doesn&apos;t hold it yet. {FIND_IT_LATER}</p>
        <button type="button" onClick={async () => { setSaved(true); await markSaved(); router.refresh(); }} className="mt-2 rounded-lg border border-line-strong px-3 py-1.5 font-medium text-ink hover:bg-hover">
          I&apos;ve saved it
        </button>
      </div>
    );
  }
  return <RecoveryKeyBox value={value} business={business} onSaved={() => router.refresh()} titled={false} />;
}

const LATER = "sf-recovery-key-later";

/**
 * Under the header until its person presses "I've saved it", on every page, in
 * full: not lost after a reload or a recording. "Remind me later" folds it to
 * one line that opens it again, for the rest of this browser session. Asked
 * again after the team's keys are reset (`note` then says why).
 */
export default function RecoveryKeyReminder({ workspaceId, fingerprint, business, hiddenOn, note }: { workspaceId: string; fingerprint: string | null; business: string; hiddenOn: string | null; note?: string }) {
  const router = useRouter();
  const hidden = usePathname() === hiddenOn;
  const { value } = useDeviceKey(workspaceId, fingerprint);
  const [later, setLater] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    try {
      setLater(sessionStorage.getItem(LATER) === workspaceId);
    } catch {
      /* storage blocked: shown in full */
    }
  }, [workspaceId]);
  function remindLater(on: boolean) {
    setLater(on);
    try {
      if (on) sessionStorage.setItem(LATER, workspaceId);
      else sessionStorage.removeItem(LATER);
    } catch {
      /* storage blocked: folded until the next page */
    }
  }
  // Staff land here straight after joining (components/JoinTeam.tsx): the key is shown in full.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("joined")) remindLater(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (hidden || saved || !value) return null;
  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6" data-testid="recovery-key-reminder">
      {!later ? (
        <>
          {note && <p className="mb-2 text-sm font-medium text-warn-fg">{note}</p>}
          <RecoveryKeyBox value={value} business={business} onSaved={() => { setSaved(true); router.refresh(); }} onLater={() => remindLater(true)} />
        </>
      ) : (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warn-line bg-warn-bg px-4 py-2.5 text-sm text-warn-fg">
          <p>{note ?? "You haven't saved your recovery key yet. You need it to open your videos on another device."}</p>
          <button type="button" onClick={() => remindLater(false)} className="font-medium underline">Show recovery key</button>
        </div>
      )}
    </div>
  );
}
