import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { requirePageUser } from "@/lib/session";
import { isSupportAdmin } from "@/lib/support/admin";
import { isSupportAgent } from "@/lib/support/tickets";
import { canInstall, readManifest } from "@/lib/ai/speechModel";
import CompForm, { CompAiForm } from "./CompForm";
import SpeechModelPanel, { type ModelStatus } from "./SpeechModelPanel";

export const metadata: Metadata = { title: "Free plans" };

/** Founder-only: give a paid plan free of charge, for trials and partners. */
export default async function Accounts() {
  const { user } = await requirePageUser("/support/accounts", { allowPaused: true, allowSuspended: true, allowTermsPending: true });
  if (!isSupportAgent(user.email)) notFound();
  if (user.suspendedAt && !isSupportAdmin(user.email)) redirect("/suspended");
  const comped = await db.workspace.findMany({
    where: { complimentaryPlan: { not: null } },
    orderBy: { createdAt: "desc" },
    include: { members: { where: { role: "OWNER" }, include: { user: { select: { email: true } } } } },
  });
  const manifest = canInstall() ? await readManifest(true) : null;
  const model: ModelStatus = manifest && {
    revision: manifest.revision,
    files: Object.keys(manifest.files).length,
    bytes: Object.values(manifest.files).reduce((n, f) => n + f.bytes, 0),
    installedAt: manifest.installedAt,
  };
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/support" className="text-sm text-accent hover:underline">← Support inbox</Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Free plans</h1>
      <p className="mt-2 text-sm text-muted">
        Give someone a paid plan without a card. They keep everything if they later pay, and nothing changes for them in the meantime. Ask them to sign in once
        first so their workspace exists.
      </p>
      <CompForm plans={Object.entries(PLANS).map(([id, p]) => ({ id, name: p.name }))} />
      <CompAiForm />
      <h2 className="mt-8 text-lg font-semibold text-ink">Currently free</h2>
      {comped.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No one yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
          {comped.map((w) => (
            <li key={w.id} className="flex justify-between gap-3 p-4 text-sm">
              <span className="text-ink">
                {w.name} <span className="text-dim">({w.members[0]?.user.email})</span>
              </span>
              <span className="text-muted">
                {w.stripeSubscriptionId ? `Paying, ${PLANS[w.plan].name}` : PLANS[w.complimentaryPlan!].name}
                {w.aiAssistComplimentary && (w.aiAssist ? " + AI summaries" : " + AI summaries (switched off)")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <SpeechModelPanel status={model} canInstall={canInstall()} />
    </main>
  );
}
