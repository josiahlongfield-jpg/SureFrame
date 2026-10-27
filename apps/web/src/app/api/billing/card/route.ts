import { z } from "zod";
import { portalConfiguration } from "@/lib/billing";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";
import { appUrl, stripe } from "@/lib/stripe";
import { limitByIp } from "@/lib/rateLimit";
import { currentCustomer } from "@/lib/subscription";

const Body = z.object({ back: z.enum(["/pricing", "/settings/billing"]).default("/settings/billing") });

/** Opens Stripe's page for changing the card on the subscription, then comes back here. */
export const POST = handle(async (req: Request) => {
  await limitByIp("billing", 20, 600);
  const me = await requireUser();
  requireRole(me, "OWNER");
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) throw new HttpError(400, "Invalid request");
  const { back } = body.data;
  // A customer deleted in Stripe (or from test mode) is forgotten rather than failing here.
  const customer = await currentCustomer(me.workspace);
  if (!customer) throw new HttpError(400, "No subscription yet");
  const session = await stripe().billingPortal.sessions.create({
    customer,
    configuration: await portalConfiguration(),
    flow_data: { type: "payment_method_update", after_completion: { type: "redirect", redirect: { return_url: appUrl(back) } } },
    return_url: appUrl(back),
  });
  return Response.json({ url: session.url });
});
