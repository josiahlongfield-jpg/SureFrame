import { NextResponse } from "next/server";
import { cachedOfferForCode, isCodeShaped, OFFER_COOKIE, OFFER_COOKIE_OPTIONS, offerCookieValue, quietly } from "@/lib/offers";
import { limitByIp } from "@/lib/rateLimit";

/**
 * A share link for a discount code (sureframe.app/offer/SPRING20): checks the
 * code with Stripe, remembers it for checkout in a signed cookie and opens
 * the pricing page. Only real codes are signed, so the pricing page only ever
 * looks up codes made on the console. Each IP can try 30 different codes in
 * 10 minutes; opening the same link again doesn't count, so a room sharing
 * one connection can all use it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  let code = "";
  try {
    code = decodeURIComponent((await params).code).trim().toUpperCase();
  } catch {
    // A malformed link just opens the pricing page.
  }
  const to = (query = "") => NextResponse.redirect(new URL(`/pricing${query}`, req.url), 303);
  if (!isCodeShaped(code)) return to();
  let repeat = false;
  try {
    await limitByIp(`offer-link-code:${code}`, 1, 600);
  } catch {
    repeat = true;
  }
  if (!repeat) {
    try {
      await limitByIp("offer-link", 30, 600);
    } catch {
      return to("?code=busy");
    }
  }
  // Wrapped, so a code Stripe says has ended (null offer) differs from Stripe not answering in time (null lookup).
  const lookup = await quietly(cachedOfferForCode(code).then((offer) => ({ offer })));
  if (!lookup) return to("?code=busy");
  if (!lookup.offer) return to(`?ended=${encodeURIComponent(code)}`);
  const res = to();
  res.cookies.set(OFFER_COOKIE, offerCookieValue(lookup.offer.code), OFFER_COOKIE_OPTIONS);
  return res;
}
