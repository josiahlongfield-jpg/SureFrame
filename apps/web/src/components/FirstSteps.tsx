"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FirstStepsState } from "@/lib/firstSteps";
import { RecoveryKeyStep, useDeviceKey } from "./RecoveryKey";
import { PersonalLinkSteps } from "./FirstLinkSender";

/**
 * A new owner's first steps in one list, where they land after signing in:
 * save the recovery key, add a business name, add a client, record and send.
 * Each ticks itself off from what's really there (lib/firstSteps.ts); the
 * list can be hidden, and goes once everything is done.
 */
export default function FirstSteps({ steps, workspaceId, fingerprint, business }: { steps: FirstStepsState; workspaceId: string; fingerprint: string | null; business: string }) {
  const router = useRouter();
  const [hiding, setHiding] = useState(false);
  // V91: the key was saved on another device, but this one is still locked: the step isn't shown as done here, since
  // this is where a key that wasn't really saved would be missed.
  const deviceKey = useDeviceKey(workspaceId, fingerprint).value;
  const keyMissingHere = steps.key && !!fingerprint && deviceKey === null;
  const shown: FirstStepsState = { ...steps, key: steps.key && !keyMissingHere };
  const done = Object.values(shown).filter(Boolean).length;
  const items: { key: keyof FirstStepsState; title: string; body: React.ReactNode }[] = [
    keyMissingHere
      ? {
          key: "key",
          title: "Enter your recovery key on this device",
          body: (
            <p className="text-sm text-muted" data-testid="step-key-here">
              You saved it on another device. Type it into the box above to open your videos here. Lost it? Show it again under Settings &gt; Account on a
              device that&apos;s already unlocked.
            </p>
          ),
        }
      : { key: "key", title: "Save your recovery key", body: <RecoveryKeyStep workspaceId={workspaceId} fingerprint={fingerprint} business={business} /> },
    {
      key: "name",
      title: "Add your business name",
      body: (
        <p className="text-sm text-muted">
          Clients see it on your videos and emails.{" "}
          <Link href="/settings/branding" className="font-medium text-accent hover:underline">Add it in Branding</Link>
        </p>
      ),
    },
    {
      key: "client",
      title: "Add your first client",
      // Same wording and test id as the staff "Start here" guide on the library; the step's own title is the heading.
      body: (
        <div data-testid="start-here">
          <p className="max-w-xl text-sm text-muted">
            Put in the clients you&apos;ll send videos to, and choose how each one receives them: by email from us, or a link you copy and send yourself. You can paste a whole list at once. Then, when a video is ready, pick them and press Send. A new client&apos;s first video goes from your email or a copied link; after that, we email the clients set to Email.
          </p>
          <PersonalLinkSteps className="mt-3" />
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <Link href="/clients" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">Add your clients</Link>
            <Link href="/record" className="text-sm text-dim hover:text-ink">Record first instead</Link>
          </div>
        </div>
      ),
    },
    {
      key: "video",
      title: "Record and send your first video",
      body: (
        <p className="text-sm text-muted">
          Record your screen, your camera or both, then pick who it&apos;s for.{" "}
          <Link href="/record" className="font-medium text-accent hover:underline">New recording</Link>
        </p>
      ),
    },
  ];

  async function hide() {
    setHiding(true);
    await fetch("/api/workspace/first-steps", { method: "POST" }).catch(() => null);
    router.refresh();
  }

  return (
    <section className="mb-8 rounded-2xl border border-line bg-surface p-5 sm:p-8" data-testid="first-steps" aria-labelledby="first-steps-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Start here</p>
          <h2 id="first-steps-title" className="mt-1 text-xl font-semibold text-ink">Your first steps</h2>
          <p className="mt-1 text-sm text-dim" data-testid="first-steps-count">{done} of {items.length} done</p>
        </div>
        <button type="button" onClick={hide} disabled={hiding} className="rounded-lg px-2 py-1 text-sm text-dim hover:bg-hover hover:text-ink" data-testid="first-steps-hide">
          Hide this list
        </button>
      </div>
      <ol className="mt-5 grid gap-3">
        {items.map((item, i) => {
          const ticked = shown[item.key];
          return (
            <li key={item.key} className={`rounded-xl border px-4 py-3 ${ticked ? "border-line" : "border-primary-line"}`} data-testid={`step-${item.key}`} data-done={ticked ? "yes" : "no"}>
              <p className={`flex items-center gap-3 font-medium ${ticked ? "text-dim" : "text-ink"}`}>
                <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${ticked ? "bg-ok-bg text-ok-fg" : "border border-line-strong font-mono text-muted"}`}>
                  {ticked ? "✓" : i + 1}
                </span>
                <span className={ticked ? "line-through decoration-1" : ""}>{item.title}</span>
                {ticked && <span className="sr-only">(done)</span>}
              </p>
              {!ticked && <div className="mt-3 sm:pl-9">{item.body}</div>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
