import { BRAND } from "@/lib/brand";
import { teamEmail } from "@/lib/teamEmail";
import { appUrl } from "@/lib/stripe";

/**
 * Tells someone invited by email to expect the join link. The link itself can't be in it: its end (#k=…)
 * holds the key to the team's encrypted videos, which never reaches our servers, so the person inviting
 * sends it themselves (components/TeamManager.tsx). Nothing here lets anyone join.
 */
export function inviteEmail(o: { business: string; inviter: string; admin: boolean; logoUrl?: string | null; color?: string | null }) {
  return teamEmail({
    business: o.business,
    subject: `${o.inviter} invited you to join ${o.business} on ${BRAND.name}`,
    lead: `${o.inviter} invited you to join ${o.business}'s team on ${BRAND.name}${o.admin ? " as an admin" : ""}, to record videos for its clients and reply to them.`,
    lines: [
      { text: `${o.inviter} will send you your private join link themselves, by text, chat or their own email. It holds the key to the team's encrypted videos, so it can't come from us.` },
      { text: "When it arrives, open it in the browser you'll use. It works once and expires 7 days after it was made." },
      { text: `No link after a day, or it says it has expired? Ask ${o.inviter} to send it again or make you a new one.` },
    ],
    button: { label: `About ${BRAND.name}`, link: appUrl("/about") },
    footer: `Not expecting this? You can ignore it: nothing happens unless you open the link ${o.inviter} sends.`,
    logoUrl: o.logoUrl,
    color: o.color,
  });
}

/** Tells someone they were taken off a team, so they don't only find out the next time they sign in. */
export function removedEmail(o: { business: string; logoUrl?: string | null; color?: string | null }) {
  return teamEmail({
    business: o.business,
    subject: `You're no longer on ${o.business}'s team`,
    lead: `An owner or admin of ${o.business} removed you from their team on ${BRAND.name}, so you can no longer open its videos or clients.`,
    lines: [
      { text: `Your ${BRAND.name} login still works. You can use it for a business of your own, free, or delete it under Settings > Account.` },
      { text: "If that's a mistake, ask them for a new invite link." },
    ],
    button: { label: `Open ${BRAND.name}`, link: appUrl("/library") },
    logoUrl: o.logoUrl,
    color: o.color,
  });
}
