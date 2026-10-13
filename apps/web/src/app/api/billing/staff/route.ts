import { z } from "zod";
import { db } from "@/lib/db";
import { enforceSeatLimits } from "@/lib/seatLimits";
import { ACTIVE_STATUSES, addOnChanges, changeAddOns, hasFoundingPrices, intervalOf, keyFor, priceId, unpaid } from "@/lib/billing";
import { PLANS, TEAM_PLANS } from "@/lib/plans";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { currentSubscription } from "@/lib/subscription";
import { limitByIp } from "@/lib/rateLimit";
import { staffUsage } from "@/lib/team";

const Body = z.object({ extraStaff: z.number().int().min(0).max(500) });

/**
 * Set how many extra staff logins a Studio or Agency workspace buys on top of
 * its plan. Billed as a quantity on the existing Stripe subscription.
 */
export const POST = handle(async (req: Request) => {
  const me = await requireUser();
  requireRole(me, "OWNER");
  const { workspace } = me;
  const body = Body.safeParse(await req.json());
  await limitByIp("billing", 20, 600);
  if (!body.success) throw new HttpError(400, "Invalid staff count");
  if (!TEAM_PLANS.includes(workspace.plan) || !workspace.stripeSubscriptionId) throw new HttpError(400, "Extra staff are available on Studio and Agency");

  // Invites still waiting hold a login too, so they count.
  const { members, pending, used } = await staffUsage(workspace);
  if (PLANS[workspace.plan].staffSeats + body.data.extraStaff < used) {
    throw new HttpError(400, `You have ${members} people on your team${pending ? ` and ${pending} waiting to join` : ""}. Remove someone or cancel an invite before lowering your staff logins.`);
  }

  const sub = await currentSubscription(workspace);
  if (!sub) throw new HttpError(400, "Start a paid subscription first");
  if (!ACTIVE_STATUSES.has(sub.status)) throw new HttpError(400, "Your subscription is not active");
  const price = await priceId(keyFor("staff_seat", intervalOf(sub), hasFoundingPrices(sub)));
  const items = addOnChanges(sub, "staff_seat", price, body.data.extraStaff);
  const charge = await changeAddOns(sub, items, { adds: body.data.extraStaff > workspace.extraStaffSeats });
  if (!charge.paid) return unpaid(charge);
  // The webhook confirms; update now so the page reflects it immediately.
  await db.workspace.update({ where: { id: workspace.id }, data: { extraStaffSeats: body.data.extraStaff } });
  await enforceSeatLimits(workspace.id);
  return Response.json({ extraStaff: body.data.extraStaff });
});
