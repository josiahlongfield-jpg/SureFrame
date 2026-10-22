"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { isEmailBlocked } from "@/lib/blockedEmail";
import { db } from "@/lib/db";
import { plainEmail } from "@/lib/emailAddress";
import { safeNext } from "@/lib/secrets";
import { countSignInEmail, signInEmailLimited } from "@/lib/signInGuard";
import { SENT_AT_COOKIE, SENT_TO_COOKIE } from "./errors";
import { withKeep } from "@/lib/activity";

/**
 * Emails a sign-in link, from the sign-in page or "Send again" on the check
 * page. Failures go back to the page the form was on, saying why.
 */
export async function emailLink(fd: FormData) {
  const email = plainEmail(String(fd.get("email") ?? ""));
  // "Keep me signed in" goes in the link too, for when it's opened in another browser (lib/activity.ts KEEP_PARAM).
  const asked = safeNext(String(fd.get("next") ?? ""));
  const redirectTo = fd.get("keep") === "1" ? withKeep(asked) : asked;
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
  // Closed by support: the closure email says it can't be signed in to, so no link goes out. The page carries on as for
  // anyone (it never says which accounts exist or were closed); the email explains, to whoever reads that inbox.
  const closed = await db.user.findUnique({ where: { email: email! }, select: { email: true, closedAt: true, deleteAt: true } });
  if (closed?.closedAt) {
    const { sendClosedAccountSignIn } = await import("@/lib/support/admin");
    try {
      await countSignInEmail(email!);
      await sendClosedAccountSignIn({ email: closed.email, closedAt: closed.closedAt, deleteAt: closed.deleteAt });
    } catch {
      failed = true;
    }
    if (failed) back("send");
    (await cookies()).set(SENT_TO_COOKIE, email!, { httpOnly: true, sameSite: "lax", path: "/login", maxAge: 3600 });
    (await cookies()).set(SENT_AT_COOKIE, String(Date.now()), { httpOnly: true, sameSite: "lax", path: "/login", maxAge: 3600 });
    redirect(`/login/check?next=${encodeURIComponent(redirectTo)}${again ? "&again=1" : ""}${signup}`);
  }
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
  (await cookies()).set(SENT_AT_COOKIE, String(Date.now()), { httpOnly: true, sameSite: "lax", path: "/login", maxAge: 3600 });
  redirect(`/login/check?next=${encodeURIComponent(redirectTo)}${again ? "&again=1" : ""}${signup}`);
}
