import type Stripe from "stripe";
import { ACTIVE_STATUSES } from "@/lib/billing";
import { db } from "@/lib/db";
import { alertFounder } from "@/lib/founderAlert";
import { rateLimit } from "@/lib/rateLimit";
import { stripe } from "@/lib/stripe";

/**
 * Staff who joined a team from an invite start a business of their own on a paid plan only (Decision 4, lib/session.ts
 * mayStartFree). Their Checkout (api/billing/start-business) is opened before there's a workspace, with this on the
 * subscription's metadata; the workspace is made here, when Stripe says the subscription is paid, so a business of
 * theirs never exists on Free first.
 */
export const NEW_BUSINESS_FOR = "newBusinessFor";

/** One email per subject a day, however many times Stripe sends the event. */
const once = (key: string) => rateLimit(`alert:${key}`, 1, 86400).then(() => true, () => false);

/**
 * A paid subscription started from /start: makes the business it pays for (once: Stripe sends several events, maybe at
 * the same moment), makes them its owner and opens it for them, and writes its id onto the subscription so it's followed
 * like any other. Returns the subscription with that id in its metadata. Anything else is returned unchanged.
 */
export async function adoptNewBusiness(sub: Stripe.Subscription): Promise<Stripe.Subscription> {
  const userId = sub.metadata?.[NEW_BUSINESS_FOR];
  if (!userId || sub.metadata?.workspaceId || !ACTIVE_STATUSES.has(sub.status)) return sub;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const made: { id: string | null; refused?: string } = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"new-business:" + userId}))`;
    // This subscription's business, made by an earlier event.
    const already = await tx.workspace.findUnique({ where: { stripeCustomerId: customer }, select: { id: true } });
    if (already) return { id: already.id };
    const user = await tx.user.findUnique({ where: { id: userId }, include: { memberships: { where: { role: "OWNER" }, select: { id: true } } } });
    if (!user || user.deleteAt || user.closedAt || user.suspendedAt) return { id: null, refused: "the login is closed or suspended" };
    // Paid twice (two tabs), or they have one already: never a second business; a person refunds this one.
    if (user.memberships.length) return { id: null, refused: "they already own a business" };
    const workspace = await tx.workspace.create({
      data: { name: `${user.name ?? user.email.split("@")[0]}'s workspace`, stripeCustomerId: customer, members: { create: { userId, role: "OWNER" } } },
      select: { id: true },
    });
    // Opened for them; the welcome step then asks for its name (lib/session.ts needsWelcome).
    await tx.user.update({ where: { id: userId }, data: { activeWorkspaceId: workspace.id } });
    return { id: workspace.id };
  });
  if (!made.id) {
    if (await once(`new-business:${sub.id}`)) {
      await alertFounder("A paid subscription has no business", [
        `Subscription ${sub.id} was paid from the Start your own business page by login ${userId}, but no business was made: ${made.refused}.`,
        "Cancel and refund it in the Stripe Dashboard, under Customers.",
      ]);
    }
    return sub;
  }
  await stripe().subscriptions.update(sub.id, { metadata: { workspaceId: made.id } });
  console.log("[billing] new business started on a paid plan", JSON.stringify({ user: userId, workspace: made.id, subscription: sub.id }));
  return { ...sub, metadata: { ...sub.metadata, workspaceId: made.id } };
}
