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
export default async function Accounts({ searchParams }: { searchParams: Promise<{ email?: string; plan?: string }> }) {
  const { user } = await requirePageUser("/support/accounts", { allowPaused: true, allowSuspended: true, allowTermsPending: true });
  if (!isSupportAgent(user.email)) notFound();
  if (user.suspendedAt && !isSupportAdmin(user.email)) redirect("/suspended");
  const admin = isSupportAdmin(user.email);
  const prefill = await searchParams;
  const comped = await db.workspace.findMany({
    where: { complimentaryPlan: { not: null } },
    orderBy: { createdAt: "desc" },
    include: { members: { where: { role: "OWNER" }, include: { user: { select: { email: true } } } } },
  });
  // "End" on the Currently free list fills in the form below (P22): say whose plan it ends and what's left to do.
  const ending =
    prefill.plan === "FREE" && prefill.email
      ? comped.find((w) => w.members[0]?.user.email.toLowerCase() === prefill.email!.toLowerCase() && !w.stripeSubscriptionId)
      : undefined;
  const manifest = canInstall() ? await readManifest(true) : null;
  const model: ModelStatus = manifest && {
    revision: manifest.revision,
    files: Object.keys(manifest.files).length,
    bytes: Object.values(manifest.files).reduce((n, f) => n + f.bytes, 0),
    installedAt: manifest.installedAt,
  };
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Free plans</h1>
      <p className="mt-2 text-sm text-muted">
        Give someone a paid plan without a card. They keep everything if they later pay, and nothing changes for them in the meantime. Ask them to sign in once
        first so their workspace exists.
      </p>
      <p className="mt-2 text-sm text-muted" data-testid="comp-includes">
        A free plan gives the plan&rsquo;s clients, staff logins, video length and branding. It doesn&rsquo;t include cloud backup (that needs a paid
        subscription) or AI transcripts and summaries unless you switch those on below; their Billing page says so too.
      </p>
      <CompForm key={`${prefill.email ?? ""}|${prefill.plan ?? ""}`} plans={Object.entries(PLANS).map(([id, p]) => ({ id, name: p.name }))} email={prefill.email?.slice(0, 320)} plan={prefill.plan && prefill.plan in PLANS ? prefill.plan : ""}
        ending={ending ? `Ending ${ending.name}'s ${PLANS[ending.complimentaryPlan!].name}${ending.aiAssistComplimentary ? " (and its free AI summaries)" : ""}: add a reason and press Save.` : null}
      />
      <CompAiForm />
      <h2 className="mt-8 text-lg font-semibold text-ink">Currently free</h2>
      {comped.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No one yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
          {comped.map((w) => (
            <li key={w.id} className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className="min-w-0 text-ink">
                {admin ? (
                  <Link href={`/support/workspaces/${w.id}`} className="font-medium text-accent hover:underline">
                    {w.name}
                  </Link>
                ) : (
                  w.name
                )}{" "}
                <span className="break-all text-dim">({w.members[0]?.user.email})</span>
              </span>
              <span className="flex flex-wrap items-center gap-x-3 text-muted sm:shrink-0">
                <span>
                  {w.stripeSubscriptionId ? `Paying, ${PLANS[w.plan].name}` : PLANS[w.complimentaryPlan!].name}
                  {w.aiAssistComplimentary && (w.aiAssist ? " + AI summaries" : " + AI summaries (switched off)")}
                </span>
                {!w.stripeSubscriptionId && w.members[0] && (
                  // Fills in the form above; the reason is still needed.
                  <Link href={`/support/accounts?email=${encodeURIComponent(w.members[0].user.email)}&plan=FREE#comp`} className="text-accent hover:underline" data-testid="end-comp">
                    End
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <SpeechModelPanel status={model} canInstall={canInstall()} />
    </div>
  );
}
