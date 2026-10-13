import { NextResponse } from "next/server";
import { isCodeShaped, OFFER_COOKIE, OFFER_COOKIE_DAYS } from "@/lib/offers";

/**
 * A share link for a discount code (sureframe.app/offer/SPRING20): remembers
 * the code for checkout and opens the pricing page, which says whether it's
 * still valid. The code itself is checked with Stripe there and at checkout.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await params).code).trim();
  const res = NextResponse.redirect(new URL("/pricing", req.url), 303);
  if (isCodeShaped(code)) {
    res.cookies.set(OFFER_COOKIE, code.toUpperCase(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: OFFER_COOKIE_DAYS * 86400,
    });
  }
  return res;
}
