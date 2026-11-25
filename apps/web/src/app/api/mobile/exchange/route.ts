import crypto from "node:crypto";
import { z } from "zod";
import { encode } from "next-auth/jwt";
import { ACTIVITY_COOKIE } from "@/lib/activity";
import { activityMark } from "@/lib/activityMark";
import { db } from "@/lib/db";
import { mobileSignInEnabled } from "@/lib/mobileSignIn";
import { limitByIp } from "@/lib/rateLimit";
import { appSecret } from "@/lib/secrets";
import { ACCOUNT_CLOSED_BY_SUPPORT, ACCOUNT_SUSPENDED, handle, HttpError } from "@/lib/session";
import { EMAIL_BLOCKED, isEmailBlocked } from "@/lib/blockedEmail";
import { appUrl } from "@/lib/stripe";

const Body = z.object({ code: z.string().min(20).max(100), verifier: z.string().min(43).max(128) });
const MAX_AGE = 30 * 24 * 60 * 60;

/** Trade a one-time code plus the app's PKCE verifier for a session the app sends as a cookie. */
export const POST = handle(async (req: Request) => {
  if (!mobileSignInEnabled()) throw new HttpError(404, "Not found");
  const body = Body.safeParse(await req.json());
  await limitByIp("mobile-exchange", 20, 600);
  if (!body.success) throw new HttpError(400, "Invalid request");
  const codeHash = crypto.createHash("sha256").update(body.data.code).digest("hex");
  // Mark used atomically so a code works exactly once.
  const claimed = await db.mobileCode.updateMany({ where: { codeHash, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new HttpError(400, "That sign-in has expired. Try again from the app.");
  const row = await db.mobileCode.findUniqueOrThrow({ where: { codeHash } });
  const expected = Buffer.from(row.challenge);
  const actual = Buffer.from(crypto.createHash("sha256").update(body.data.verifier).digest("base64url"));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new HttpError(400, "That sign-in has expired. Try again from the app.");

  const user = await db.user.findUnique({ where: { id: row.userId } });
  if (!user) throw new HttpError(400, "That account no longer exists.");
  // Blocked or closed by support (lib/support/admin.ts): it can't be kept.
  if (await isEmailBlocked(user.email)) throw new HttpError(403, EMAIL_BLOCKED);
  if (user.closedAt) throw new HttpError(403, ACCOUNT_CLOSED_BY_SUPPORT, "ACCOUNT_CLOSED");
  // Closed and waiting to be deleted (lib/accountDeletion.ts): it can only be kept on the website.
  if (user.deleteAt) throw new HttpError(403, "This account is closed. To keep it, sign in on the SureFrame website before its deletion date.");
  // Suspended by support since the code was made.
  if (user.suspendedAt) throw new HttpError(403, ACCOUNT_SUSPENDED, "ACCOUNT_SUSPENDED");
  const cookie = appUrl().startsWith("https://") ? "__Secure-authjs.session-token" : "authjs.session-token";
  const token = await encode({ token: { sub: user.id, email: user.email, name: user.name, signedInAt: Date.now() }, secret: appSecret(), salt: cookie, maxAge: MAX_AGE });
  await db.mobileCode.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } });
  // `activity` is the signed activity cookie the app sends beside the session (src/middleware.ts): it can't make
  // one up itself, and a session without one counts as signed out.
  return Response.json({ cookie, token, activity: `${ACTIVITY_COOKIE}=${await activityMark(user.id)}` });
});
