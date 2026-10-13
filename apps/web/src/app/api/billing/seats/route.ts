import { z } from "zod";
import { db } from "@/lib/db";
import { enforceSeatLimits } from "@/lib/seatLimits";
import { ACTIVE_STATUSES, addOnChanges, changeAddOns, hasFoundingPrices, intervalOf, keyFor, priceId, unpaid } from "@/lib/billing";
import { PLANS } from "@/lib/plans";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { currentSubscription } from "@/lib/subscription";
import { limitByIp } from "@/lib/rateLimit";

const Body = z.object({ extraSeats: z.number().int().min(0).max(1000) });

/**
 * Set how many extra client seats the workspace buys on top of its plan.
 * Billed as a quantity on the workspace's existing Stripe subscription.
 */
export const POST = handle(async (req: Request) => {
  const me = await requireUser();
  requireRole(me, "OWNER");
  const { workspace } = me;
  const body = Body.safeParse(await req.json());
  await limitByIp("billing", 20, 600);
  if (!body.success) throw new HttpError(400, "Invalid seat count");
  if (!workspace.stripeSubscriptionId) throw new HttpError(400, "Upgrade to a paid plan to add client seats");

  const used = await db.client.count({ where: { workspaceId: workspace.id, removedAt: null } });
  if (PLANS[workspace.plan].clientSeats + body.data.extraSeats < used) {
    throw new HttpError(400, `You have ${used} clients. Remove some before lowering your seats.`);
  }

  const sub = await currentSubscription(workspace);
  if (!sub) throw new HttpError(400, "Start a paid subscription first");
  if (!ACTIVE_STATUSES.has(sub.status)) throw new HttpError(400, "Your subscription is not active");
  const price = await priceId(keyFor("client_seat", intervalOf(sub), hasFoundingPrices(sub)));
  const items = addOnChanges(sub, "client_seat", price, body.data.extraSeats);
  const charge = await changeAddOns(sub, items, { adds: body.data.extraSeats > workspace.extraClientSeats });
  if (!charge.paid) return unpaid(charge);
  // The webhook confirms; update now so the page reflects it immediately.
  await db.workspace.update({ where: { id: workspace.id }, data: { extraClientSeats: body.data.extraSeats } });
  await enforceSeatLimits(workspace.id);
  return Response.json({ extraSeats: body.data.extraSeats });
});
