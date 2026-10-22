"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Plan } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { enforceSeatLimits } from "@/lib/seatLimits";
import { PLANS } from "@/lib/plans";
import { BRAND } from "@/lib/brand";
import { appUrl } from "@/lib/stripe";
import { activeSupportAgent, logAdmin, notice, QUESTIONS, sendNotice } from "@/lib/support/admin";
import { teamPath } from "@/lib/teamLink";
import { videosUsed } from "@/lib/videoAllowance";
import { currentSubscription } from "@/lib/subscription";

/** `own`: refused because it's the support person's own business; the form then offers a box to go ahead anyway (P19). */
export type CompResult = { ok: boolean; message: string; own?: boolean } | null;

/** The internal reason every change needs, for the support log. */
const reasonIn = (form: FormData) => String(form.get("reason") ?? "").trim();
const REASON_NEEDED = "Write the reason for this (500 characters at most). It's kept in the support log, not shown to the customer.";
/** Emailed to the owner unless unticked, and not while their account is closed (it's signed out everywhere). */
const tellOwner = (form: FormData, ws: { deleteAt: Date | null; closedAt: Date | null }) => form.get("notify") === "on" && !ws.deleteAt && !ws.closedAt;

/** The support agent, for the support log. */
const agentOf = (session: { user?: { id?: string | null; email?: string | null } } | null) => ({ userId: session?.user?.id ?? "", email: session?.user?.email ?? "" });

/**
 * Support giving its own business a free plan or AI is refused the first time, with a box to tick to go ahead (a test,
 * say), so it isn't done by mistake (P19).
 */
function ownWorkspace(session: { user?: { id?: string | null } } | null, owner: { userId: string; workspace: { name: string } }, form?: FormData): CompResult {
  if (owner.userId !== session?.user?.id) return null;
  if (form?.get("own") === "on") return null;
  return { ok: false, own: true, message: `${owner.workspace.name} is your own business (you're signed in as its owner). Tick "Yes, my own business" and save again if that's what you meant.` };
}

/** Gives (or takes back) a free paid plan on the workspace an email address owns. */
export async function setComplimentary(_prev: CompResult, form: FormData): Promise<CompResult> {
  const session = await auth();
  if (!(await activeSupportAgent())) redirect("/library");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const choice = String(form.get("plan") ?? "");
  if (!email.includes("@")) return { ok: false, message: "Enter their sign-in email address." };
  if (!(choice in PLANS)) return { ok: false, message: "Choose a plan, or Back to Free to end one." };
  const plan = choice as Plan;
  const reason = reasonIn(form);
  if (!reason || reason.length > 500) return { ok: false, message: REASON_NEEDED };

  const owner = await db.membership.findFirst({ where: { role: "OWNER", user: { email } }, include: { workspace: true }, orderBy: { workspace: { createdAt: "asc" } } });
  if (!owner) return { ok: false, message: `${email} hasn't signed up yet, or doesn't own a workspace. Ask them to sign in once first.` };
  // A subscription Stripe no longer has (say one from test mode) is cleared here, not counted as paying.
  const ws = (await currentSubscription(owner.workspace)) ? owner.workspace : await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } });
  if (ws.stripeSubscriptionId) return { ok: false, message: `${ws.name} already pays for ${PLANS[ws.plan].name}, so nothing was changed.` };
  // Nothing to change: never logged, and never emailed as if something ended or started (P18).
  if (plan === "FREE" && !ws.complimentaryPlan && ws.plan === "FREE") return { ok: false, message: `${ws.name} isn't on a complimentary plan, so nothing was changed.` };
  if (plan !== "FREE" && ws.complimentaryPlan === plan && ws.plan === plan) return { ok: false, message: `${ws.name} already has ${PLANS[plan].name} free of charge, so nothing was changed.` };
  // Ending one needs no second thought; giving one to support's own business does.
  const own = plan === "FREE" ? null : ownWorkspace(session, owner, form);
  if (own) return own;

  const row = await db.$transaction(async (tx) => {
    const after = await tx.workspace.update({
      where: { id: ws.id },
      // Free AI summaries only come with a free plan.
      data: plan === "FREE" ? { plan: "FREE", complimentaryPlan: null, aiAssistComplimentary: false, aiAssist: false } : { plan, complimentaryPlan: plan },
    });
    return logAdmin(tx, agentOf(session), {
      action: "plan.complimentary",
      workspaceId: ws.id,
      userId: owner.userId,
      target: `${ws.name} (${email})`,
      reason,
      details: {
        before: { plan: ws.plan, complimentaryPlan: ws.complimentaryPlan, aiAssist: ws.aiAssist, aiAssistComplimentary: ws.aiAssistComplimentary },
        after: { plan: after.plan, complimentaryPlan: after.complimentaryPlan, aiAssist: after.aiAssist, aiAssistComplimentary: after.aiAssistComplimentary },
      },
    });
  });
  await enforceSeatLimits(ws.id);
  if (tellOwner(form, ws)) {
    const limit = PLANS.FREE.maxVideos!;
    const { used } = plan === "FREE" ? await videosUsed(ws.id) : { used: 0 };
    // Ending the plan ends the free AI summaries with it: said in this one email, so no second one follows (P23).
    const aiEnded = plan === "FREE" && ws.aiAssistComplimentary;
    await sendNotice(
      row.id,
      email,
      notice({
        subject: plan === "FREE" ? `Your free ${BRAND.name} plan has ended` : `You have the ${PLANS[plan].name} plan free of charge`,
        lead:
          plan === "FREE"
            ? `The ${PLANS[ws.plan].name} plan ${BRAND.name} gave ${ws.name} free of charge has ended${aiEnded ? ", and so have the free AI transcripts and summaries that came with it" : ""}, so it's now on the Free plan.`
            : `${BRAND.name} has given ${ws.name} the ${PLANS[plan].name} plan free of charge. It was on ${PLANS[ws.plan].name} before.`,
        lines:
          plan === "FREE"
            ? [
                { text: `The Free plan includes ${limit} videos in total. You've used ${Math.min(used, limit)}, so you have ${Math.max(0, limit - used)} left.` },
                { text: "To record more, or to get your paid features back, choose a plan in Settings > Billing." },
              ]
            : [
                { text: "It stays until we end it or you start paying for a plan." },
                { text: "Cloud backup, extra client seats and extra staff logins need a paid subscription, so they can't be added to it." },
              ],
        button: { label: "Open Billing", link: appUrl(teamPath("/settings/billing", ws.id)) },
        footer: QUESTIONS,
      }),
    );
  }
  revalidatePath("/support/accounts");
  return {
    ok: true,
    message: plan === "FREE" ? `${ws.name} is back on the Free plan.` : `${ws.name} now has ${PLANS[plan].name} free of charge.`,
  };
}

/** Gives (or takes back) the AI summaries add-on, free, on a workspace with a complimentary plan. */
export async function setComplimentaryAi(_prev: CompResult, form: FormData): Promise<CompResult> {
  const session = await auth();
  if (!(await activeSupportAgent())) redirect("/library");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const on = form.get("ai") === "on";
  if (!email.includes("@")) return { ok: false, message: "Enter their sign-in email address." };
  const reason = reasonIn(form);
  if (!reason || reason.length > 500) return { ok: false, message: REASON_NEEDED };

  const owner = await db.membership.findFirst({ where: { role: "OWNER", user: { email } }, include: { workspace: true }, orderBy: { workspace: { createdAt: "asc" } } });
  if (!owner) return { ok: false, message: `${email} hasn't signed up yet, or doesn't own a workspace. Ask them to sign in once first.` };
  const ws = (await currentSubscription(owner.workspace)) ? owner.workspace : await db.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } });
  if (ws.stripeSubscriptionId) return { ok: false, message: `${ws.name} pays by card, so they can add AI summaries in Settings > Billing. Nothing was changed.` };
  if (on && !ws.complimentaryPlan) return { ok: false, message: `Give ${ws.name} a free paid plan first. AI summaries aren't available on Free.` };
  // Nothing to change: not logged or emailed (P23: ending a free plan already ended its AI summaries, and said so).
  if (!on && !ws.aiAssistComplimentary) return { ok: false, message: `${ws.name} doesn't have free AI summaries, so they're already off and nothing was changed.` };
  if (on && ws.aiAssistComplimentary && ws.aiAssist) return { ok: false, message: `${ws.name} already has AI summaries free of charge, switched on, so nothing was changed.` };
  const own = on ? ownWorkspace(session, owner, form) : null;
  if (own) return own;

  const row = await db.$transaction(async (tx) => {
    await tx.workspace.update({ where: { id: ws.id }, data: { aiAssistComplimentary: on, aiAssist: on } });
    return logAdmin(tx, agentOf(session), {
      action: "plan.complimentary_ai",
      workspaceId: ws.id,
      userId: owner.userId,
      target: `${ws.name} (${email})`,
      reason,
      details: { before: { aiAssist: ws.aiAssist, aiAssistComplimentary: ws.aiAssistComplimentary }, after: { aiAssist: on, aiAssistComplimentary: on } },
    });
  });
  if (tellOwner(form, ws)) {
    await sendNotice(
      row.id,
      email,
      notice({
        subject: on ? `AI summaries are on for ${ws.name}, free of charge` : `We've switched off your free AI summaries`,
        lead: on
          ? `${BRAND.name} has switched on AI transcripts and summaries for ${ws.name}, free of charge. Your clients see a note that you use AI summaries.`
          : `${BRAND.name} has switched off the AI transcripts and summaries it gave ${ws.name} free of charge.`,
        lines: [{ text: on ? "You can switch them off in Settings > Billing." : "You can add them to a paid plan in Settings > Billing." }],
        button: { label: "Open Billing", link: appUrl(teamPath("/settings/billing", ws.id)) },
        footer: QUESTIONS,
      }),
    );
  }
  revalidatePath("/support/accounts");
  return {
    ok: true,
    message: on
      ? `${ws.name} now has AI summaries free of charge, switched on. Their owner can switch it off in Settings > Billing.`
      : `AI summaries are off for ${ws.name}.`,
  };
}
