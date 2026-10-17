"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { isEmailBlocked } from "@/lib/blockedEmail";
import { plainEmail } from "@/lib/emailAddress";
import { safeNext } from "@/lib/secrets";
import { signInEmailLimited } from "@/lib/signInGuard";
import { SENT_TO_COOKIE } from "./errors";

/**
 * Emails a sign-in link, from the sign-in page or "Send again" on the check
 * page. Failures go back to the page the form was on, saying why.
 */
export async function emailLink(fd: FormData) {
  const email = plainEmail(String(fd.get("email") ?? ""));
  const redirectTo = safeNext(String(fd.get("next") ?? ""));
  const again = fd.get("again") === "1";
  const signup = fd.get("signup") === "1" ? "&signup=1" : "";
  const back = (code: string) => redirect(`${again ? "/login/check" : "/login"}?error=${code}&next=${encodeURIComponent(redirectTo)}${signup}`);
  if (!email) back("email");
  // Refused again in src/auth.ts for any way in; checked here so the page says why.
  if (await isEmailBlocked(email)) back("blocked");
  // Sending is counted inside the provider (src/auth.ts), so direct API calls are limited too;
  // this only tells the kinds of failure apart.
  const limited = await signInEmailLimited(email!);
  if (limited) back(limited === "network" ? "rate-network" : "rate");
  let failed = false;
  try {
    // With redirect off, Auth.js reports a failed send as an error URL instead of throwing.
    const url = await signIn("email", { email, redirectTo, redirect: false });
    failed = typeof url === "string" && /[?&]error=/.test(url);
  } catch {
    failed = true;
  }
  if (failed) {
    console.error("[signin] sign-in email not sent", JSON.stringify({ domain: email!.split("@")[1] }));
    back("send");
  }
  (await cookies()).set(SENT_TO_COOKIE, email!, { httpOnly: true, sameSite: "lax", path: "/login", maxAge: 3600 });
  redirect(`/login/check?next=${encodeURIComponent(redirectTo)}${again ? "&again=1" : ""}${signup}`);
}
