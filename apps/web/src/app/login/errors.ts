import { EMAIL_BLOCKED } from "@/lib/blockedEmail";

/** The address the last sign-in link went to, for "Check your email" (only this browser, briefly). */
export const SENT_TO_COOKIE = "sf_signin_to";
/** When it was sent, so a reload of "Check your email" doesn't restart the Send again wait (O97). */
export const SENT_AT_COOKIE = "sf_signin_at";

/** What went wrong signing in, for the sign-in and "Check your email" pages. */
export function errorText(code: string) {
  if (code === "blocked") return EMAIL_BLOCKED;
  if (code === "rate") return "Too many sign-in emails to this address in the last hour. Check your inbox and spam folder for the latest one, or wait a little and try again.";
  if (code === "rate-network") return "Too many sign-in emails were asked for from your network (your Wi-Fi or mobile connection) in the last hour. Please wait a little and try again, or use another connection.";
  if (code === "email") return "That email address doesn't look right. Check it and try again.";
  if (code === "send") return "We couldn't send the sign-in email just now. Please try again in a few minutes, or email support@sureframe.app.";
  if (code === "code-code") return "Type the 6-digit code from the email.";
  if (code === "code-wrong") return "That code isn't right. Check the latest email and try again.";
  if (code === "code-expired") return "That code has expired, or a newer email replaced it. Use the code in the latest email, or send again.";
  if (code === "code-tries") return "Too many wrong tries for that code. Send again to get a new one.";
  if (code === "code-rate") return "Too many codes were tried from your network. Please wait a little and try again.";
  if (code === "password") return "That password isn't right. Check it and try again.";
  if (code === "Verification") return "That sign-in link has expired or was already used. Enter your email to get a new one.";
  if (code === "OAuthAccountNotLinked") return "That email is already used with another sign-in method. Use the email link instead.";
  return "Something went wrong signing in. Please try again.";
}
