import { cache } from "react";
import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { plainEmail } from "@/lib/emailAddress";
import { isEmailBlocked } from "@/lib/blockedEmail";

const providers: Provider[] = [];

// Google verifies email addresses, so it may sign into an account first
// created with an email link (and vice versa); the signIn callback below
// refuses any Google address Google hasn't verified.
if (process.env.AUTH_GOOGLE_ID) {
  providers.push(
    Google({
      allowDangerousEmailAccountLinking: true,
      // Same lower-case address as an email-link account, so the two link up.
      profile: (p) => ({ id: p.sub, name: p.name, email: String(p.email ?? "").toLowerCase(), image: p.picture }),
    }),
  );
}

/**
 * One-time sign-in links by email. Live when RESEND_API_KEY is set; locally
 * AUTH_EMAIL_LINKS=true writes the emails to .data/outbox instead.
 */
const emailLinks = !!process.env.RESEND_API_KEY || process.env.AUTH_EMAIL_LINKS === "true";
if (emailLinks) {
  providers.push(
    Resend({
      id: "email",
      name: "Email",
      apiKey: process.env.RESEND_API_KEY ?? "unused",
      from: process.env.MAIL_FROM,
      // Only plain addresses: no quotes, commas, spaces or look-alike characters.
      normalizeIdentifier(identifier) {
        const email = plainEmail(identifier);
        if (!email) throw new Error("Invalid email address");
        return email;
      },
      async sendVerificationRequest({ identifier, url }) {
        const { countSignInEmail } = await import("@/lib/signInGuard");
        await countSignInEmail(identifier);
        const { sendMail } = await import("@/lib/mail");
        const { signInCodeEmail, signInEmail } = await import("@/lib/signInEmail");
        const { callbackTarget, confirmLink, forClaude } = await import("@/lib/signInLink");
        // Connecting Claude: a code instead of the link, so the sign-in can't wander off into another browser and
        // finishes in the window Claude opened. Every other sign-in gets the link.
        if (forClaude(callbackTarget(url))) {
          const { makeSignInCode } = await import("@/lib/signInCode");
          await sendMail({ to: identifier, ...signInCodeEmail(await makeSignInCode(identifier, url)) });
          return;
        }
        await sendMail({ to: identifier, ...signInEmail(confirmLink(url)) });
      },
    }),
  );
}

/** When "Sign out everywhere" was last used on this account (lib/support/admin.ts), once per request. */
const sessionsValidAfter = cache(async (userId: string) => (await db.user.findUnique({ where: { id: userId }, select: { sessionsValidAfter: true } }))?.sessionsValidAfter ?? null);

/** Shared password that protects a hosted preview's email sign-in. */
export const previewPassword = process.env.PREVIEW_PASSWORD || null;

// Email-only sign in for local development and demos. Never enable in
// production; on a hosted preview, also set PREVIEW_PASSWORD. Switched off
// automatically once real email links are configured.
// A production deploy only allows it behind PREVIEW_PASSWORD.
const isProduction = process.env.VERCEL_ENV === "production" || (process.env.NODE_ENV === "production" && !process.env.VERCEL_ENV);
// Never on the live site, whatever else is set.
const devLogin = process.env.AUTH_DEV_LOGIN === "true" && !emailLinks && process.env.VERCEL_ENV !== "production" && (!isProduction || !!previewPassword);
if (devLogin) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { email: { label: "Email", type: "email" }, password: { label: "Preview password", type: "password" } },
      async authorize(creds) {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        if (!email.includes("@")) return null;
        const { limitByIp } = await import("@/lib/rateLimit");
        const { safeEqual } = await import("@/lib/secrets");
        try {
          await limitByIp("dev-login", 20, 900);
        } catch {
          return null;
        }
        if (previewPassword && !safeEqual(String(creds?.password ?? ""), previewPassword)) return null;
        // Never makes an account for a blocked address (the sign-in page says why before it gets here).
        if (await isEmailBlocked(email)) return null;
        return db.user.upsert({ where: { email }, update: {}, create: { email, name: email.split("@")[0] } });
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // The adapter only touches the auth tables, so the client's workspace settings don't matter to it.
  adapter: PrismaAdapter(db as unknown as PrismaClient),
  session: { strategy: "jwt" },
  providers,
  pages: { signIn: "/login", verifyRequest: "/login/check", error: "/login" },
  events: {
    // Starts the browser-session activity cookie that src/middleware.ts checks,
    // for every way of signing in (including server actions, which the
    // middleware never sees as a callback request).
    // Also settles "Keep me signed in on this device" (lib/activity.ts): kept for KEEP_DAYS from now if it was
    // ticked before this sign-in, else not at all.
    async signIn() {
      const { cookies, headers } = await import("next/headers");
      const { ACTIVITY_COOKIE, BELL_VISIT_COOKIE, KEEP_COOKIE, KEEP_HEADER, KEEP_NEXT_COOKIE, activityCookie, keepCookie } = await import("@/lib/activity");
      try {
        const jar = await cookies();
        // Ticked in this browser, or carried in the emailed link (src/middleware.ts passes it on as KEEP_HEADER).
        const keep = jar.get(KEEP_NEXT_COOKIE)?.value === "1" || (await headers()).get(KEEP_HEADER) === "1";
        jar.set(ACTIVITY_COOKIE, String(Date.now()), activityCookie(undefined, keep));
        if (keep) jar.set(KEEP_COOKIE, "1", keepCookie());
        else jar.delete(KEEP_COOKIE);
        jar.delete(KEEP_NEXT_COOKIE);
        // A new visit for the bell: it shakes on the first page if anything's unread (components/NotificationBell.tsx).
        jar.delete(BELL_VISIT_COOKIE);
      } catch {
        // Not in a request that can set cookies; the callback request sets it instead.
      }
    },
    // Signing out ends "Keep me signed in" on this device too.
    async signOut() {
      const { cookies } = await import("next/headers");
      const { BELL_VISIT_COOKIE, KEEP_COOKIE } = await import("@/lib/activity");
      try {
        (await cookies()).delete(KEEP_COOKIE);
        (await cookies()).delete(BELL_VISIT_COOKIE);
      } catch {
        // Not in a request that can set cookies; the next sign-in decides it afresh anyway.
      }
    },
  },
  callbacks: {
    async signIn({ account, profile, user }) {
      if (account?.provider === "google" && profile?.email_verified !== true) return false;
      // An address blocked by support (an account closed for breaking the Terms) can't sign in or sign up
      // again, by any method: Google, the email link (checked before the link is sent, and again when used)
      // or dev login.
      if (await isEmailBlocked(user?.email, typeof profile?.email === "string" ? profile.email : null)) return "/login?error=blocked";
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        // Only a sign-in after closing an account can keep it (lib/session.ts pendingDeletion), and only one
        // after "Sign out everywhere" still works.
        token.signedInAt = Date.now();
        return token;
      }
      // "Sign out everywhere": a sign-in from before it counts as signed out (the cookie is cleared where it can be).
      // Tokens from before signedInAt existed count as older than any such date.
      if (token.sub) {
        const validAfter = await sessionsValidAfter(token.sub);
        if (validAfter && (token.signedInAt ?? 0) <= validAfter.getTime()) return null;
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.signedInAt = token.signedInAt;
      return session;
    },
  },
});

/** Which sign-in options the login page should render. */
export const authProviders = [
  ...(process.env.AUTH_GOOGLE_ID ? [{ id: "google", name: "Google" }] : []),
  ...(emailLinks ? [{ id: "email", name: "Email" }] : []),
  ...(devLogin ? [{ id: "dev", name: "Dev login" }] : []),
];
