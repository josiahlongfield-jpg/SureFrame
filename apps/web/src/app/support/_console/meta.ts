import type { Metadata } from "next";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isFounder, isSupportAdmin } from "@/lib/support/admin";
import { isSupportAgent } from "@/lib/support/tickets";

const CAN = { agent: isSupportAgent, admin: isSupportAdmin, founder: isFounder } as const;

/**
 * A support page's tab title, for the people the page is for. Anyone else signed in gets the site's not-found page
 * (app/support/layout.tsx), and its tab says so too, rather than "Support inbox" (D10). Signed out, the page sends
 * them to sign in.
 */
export function supportTitle(title: string, who: keyof typeof CAN = "agent", extra: Metadata = {}) {
  return async function generateMetadata(): Promise<Metadata> {
    const id = (await auth())?.user?.id;
    const me = id ? await db.user.findUnique({ where: { id }, select: { email: true } }) : null;
    return { ...extra, title: !me || CAN[who](me.email) ? title : "Page not found" };
  };
}
