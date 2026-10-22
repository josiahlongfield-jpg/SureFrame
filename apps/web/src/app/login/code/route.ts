import { NextResponse, type NextRequest } from "next/server";
import { plainEmail } from "@/lib/emailAddress";
import { limitByIp, rateLimit } from "@/lib/rateLimit";
import { safeNext } from "@/lib/secrets";
import { redeemSignInCode } from "@/lib/signInCode";
import { SENT_TO_COOKIE } from "../errors";

/**
 * The code typed on the Check your email page (lib/signInCode.ts). A right code goes on to the email's own sign-in
 * link, in this same window; a wrong one goes back to the page saying why. A plain form post, so the browser follows
 * the redirect itself.
 */
export async function POST(req: NextRequest) {
  const fd = await req.formData().catch(() => null);
  const next = safeNext(String(fd?.get("next") ?? ""));
  const signup = fd?.get("signup") === "1" ? "&signup=1" : "";
  const back = (error: string) => NextResponse.redirect(new URL(`/login/check?error=code-${error}&next=${encodeURIComponent(next)}${signup}`, req.url), 303);
  try {
    await limitByIp("signin-code", 30, 3600);
  } catch {
    return back("rate");
  }
  // The address the email went to, from the page that sent it (never from the form).
  const email = plainEmail(req.cookies.get(SENT_TO_COOKIE)?.value ?? "");
  if (!email) return back("expired");
  // Also a day's limit per address, so guessing can't go on all day by asking for new emails.
  try {
    await rateLimit(`signin-code:to:${email}`, 20, 86_400);
  } catch {
    return back("tries");
  }
  const result = await redeemSignInCode(email, String(fd?.get("code") ?? ""));
  if ("error" in result) return back(result.error);
  return NextResponse.redirect(new URL(result.link, req.url), 303);
}
