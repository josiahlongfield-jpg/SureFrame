import { NextResponse } from "next/server";
import { cachedOfferForCode, isCodeShaped, offerIsFor, OFFER_COOKIE, OFFER_COOKIE_OPTIONS, offerCookieValue, quietly } from "@/lib/offers";
import { clientIp, isLimited, limitByIp, rateLimit } from "@/lib/rateLimit";
import { isReferralCode, referralOffer } from "@/lib/referrals";
import { currentUser } from "@/lib/session";

/**
 * A share link for a discount code (sureframe.app/offer/SPRING20) or a
 * business's referral code (sureframe.app/offer/REF-AB12CD): checks the code, remembers it for checkout in a signed cookie and opens
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
  // A code this IP opened in the last 10 minutes is free; a new one counts towards the 30, and is only marked as
  // opened once it has passed them (so retrying a refused one counts again). A limiter error refuses too.
  try {
    const seen = `offer-link-code:${code}:ip:${await clientIp()}`;
    if (!(await isLimited(seen, 1, 600))) {
      await limitByIp("offer-link", 30, 600);
      await rateLimit(seen, 1_000_000, 600);
    }
  } catch {
    return to("?code=busy");
  }
  // Wrapped, so a code Stripe says has ended (null offer) differs from Stripe not answering in time (null lookup).
  // A business's referral code (lib/referrals.ts) is checked in our database, not Stripe.
  const lookup = await quietly(isReferralCode(code) ? referralOffer(code).then((offer) => ({ offer })) : cachedOfferForCode(code).then((offer) => ({ offer })));
  if (!lookup) return to("?code=busy");
  if (!lookup.offer) return to(`?ended=${encodeURIComponent(code)}`);
  // A code given to one business works only when signed in to it: sign in first, then come back here.
  const givenTo = "customer" in lookup.offer ? (lookup.offer.customer as string | null) : null;
  if (givenTo) {
    const me = await currentUser();
    if (!me) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/offer/${code}`)}`, req.url), 303);
    // Said as it is: the code works, just not for this business (P33).
    if (!offerIsFor({ customer: givenTo }, me.workspace.stripeCustomerId)) return to(`?other=${encodeURIComponent(code)}`);
  }
  const res = to();
  res.cookies.set(OFFER_COOKIE, offerCookieValue(lookup.offer.code), OFFER_COOKIE_OPTIONS);
  return res;
}
