import { NextResponse } from "next/server";
import { isCodeShaped, OFFER_COOKIE, OFFER_COOKIE_OPTIONS, offerCookieValue } from "@/lib/offers";
import { limitByIp } from "@/lib/rateLimit";

/**
 * A share link for a discount code (sureframe.app/offer/SPRING20): remembers
 * the code for checkout and opens the pricing page, which says whether it's
 * still valid. The code itself is checked with Stripe there and at checkout.
 * Rate limited, as each link makes a signed cookie the pricing page will
 * check with Stripe.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  let code = "";
  try {
    code = decodeURIComponent((await params).code).trim();
  } catch {
    // A malformed link just opens the pricing page.
  }
  const res = NextResponse.redirect(new URL("/pricing", req.url), 303);
  if (!isCodeShaped(code)) return res;
  try {
    await limitByIp("offer-link", 30, 600);
  } catch {
    return res;
  }
  res.cookies.set(OFFER_COOKIE, offerCookieValue(code), OFFER_COOKIE_OPTIONS);
  return res;
}
