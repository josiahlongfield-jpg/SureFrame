import { cookies } from "next/headers";
import { z } from "zod";
import { ACTIVE_STATUSES } from "@/lib/billing";
import { applyCodeToSubscription, DISCOUNT_EXPAND, isCodeShaped, offerForCode, OFFER_COOKIE, OFFER_COOKIE_DAYS } from "@/lib/offers";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { stripe } from "@/lib/stripe";
import { currentSubscription, syncSubscription } from "@/lib/subscription";
import { limitByIp } from "@/lib/rateLimit";

const Body = z.object({ code: z.string().trim().max(40) });

/**
 * A discount code typed on Settings > Billing. With a subscription it's added
 * to it (one discount at a time); without one it's kept for checkout, like a
 * share link.
 */
export const POST = handle(async (req: Request) => {
  const me = await requireUser();
  requireRole(me, "OWNER");
  const body = Body.safeParse(await req.json());
  // Tight, so codes can't be guessed by trying many.
  await limitByIp("billing-code", 10, 600);
  if (!body.success || !isCodeShaped(body.data.code)) throw new HttpError(400, "Enter the code as written: letters, numbers and dashes.");
  const { code } = body.data;
  const sub = me.workspace.stripeSubscriptionId ? await currentSubscription(me.workspace) : null;
  if (sub && ACTIVE_STATUSES.has(sub.status)) {
    const offer = await applyCodeToSubscription(sub, code);
    // The webhook does this too; now, so the page shows it straight away.
    await syncSubscription(await stripe().subscriptions.retrieve(sub.id, { expand: DISCOUNT_EXPAND }), { notify: false });
    return Response.json({ applied: true, code: offer.code, summary: offer.summary });
  }
  const offer = await offerForCode(code);
  if (!offer) throw new HttpError(400, "That code isn't valid or has ended.");
  (await cookies()).set(OFFER_COOKIE, offer.code.toUpperCase(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OFFER_COOKIE_DAYS * 86400,
  });
  return Response.json({ applied: false, code: offer.code, summary: offer.summary });
});
