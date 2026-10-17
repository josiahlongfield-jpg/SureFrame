import { z } from "zod";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { limitByIp } from "@/lib/rateLimit";
import { cancelAtPeriodEnd, keepRenewing } from "@/lib/subscription";

const Body = z.object({ keep: z.boolean().default(false) });

/**
 * Settings > Billing's "Cancel plan" (the plan ends when the paid period does) and "Keep my plan" (renewal back on).
 * Like Manage subscription, it works before agreeing to updated terms, so declining them never leaves a plan renewing.
 */
export const POST = handle(async (req: Request) => {
  await limitByIp("billing", 20, 600);
  const me = await requireUser({ allowTermsPending: true });
  requireRole(me, "OWNER");
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw new HttpError(400, "Invalid request");
  if (!me.workspace.stripeSubscriptionId) throw new HttpError(400, "There's no paid plan to cancel.");
  if (body.data.keep) {
    await keepRenewing(me.workspace);
    return Response.json({ cancelsAt: null });
  }
  const ends = await cancelAtPeriodEnd(me.workspace);
  return Response.json({ cancelsAt: ends?.toISOString() ?? null });
});
