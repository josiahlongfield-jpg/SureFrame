import { BRAND } from "@/lib/brand";
import { zoned } from "@/lib/dates";
import { db } from "@/lib/db";
import { LEGAL, LEGAL_VERSIONS } from "@/lib/legal";
import { sendMail } from "@/lib/mail";
import { TERMS_NOTICE_DAYS } from "@/lib/periods";
import { appUrl } from "@/lib/stripe";
import { teamEmail } from "@/lib/teamEmail";
import { recordsStartedAt } from "@/lib/terms";

/** The notice of new versions, with the day they take effect for this account holder. */
function termsNoticeEmail(from: Date, timezone: string | null) {
  const day = zoned(timezone).longDay(from);
  return teamEmail({
    business: BRAND.name,
    subject: `We're updating our Terms of Service and Privacy Policy`,
    // A change can apply sooner (Terms section 18); its line in `changes` then starts "Already in effect" (LEGAL-1).
    lead: `We're updating the ${BRAND.name} Terms of Service and Privacy Policy. The new versions apply to you from ${day}. Until then the versions you agreed to still apply, except for a change marked below as already in effect. The main changes:`,
    lines: [
      ...(LEGAL_VERSIONS[0]?.changes ?? []).map((text) => ({ text })),
      // The list above is the newest version's changes only; someone who never agreed to the one before finds its changes here.
      ...(LEGAL_VERSIONS.length > 1 ? [{ text: "Earlier changes are listed on our versions page", link: appUrl("/legal/archive#versions") }] : []),
      { text: "Read the new Terms of Service", link: appUrl("/legal/terms") },
      { text: "Read the new Privacy Policy", link: appUrl("/legal/privacy") },
    ],
    button: { label: "Read and agree", link: appUrl("/agree") },
    footer:
      `To keep using ${BRAND.name} from ${day}, agree to the new versions (we'll ask when you sign in). If you don't want to, you can cancel your subscription in ` +
      `Settings > Billing, and download your data or delete your account in Settings > Account, before then. Questions? Contact ${LEGAL.email}.`,
  });
}

/**
 * Emails existing account holders about new versions of the Terms of Service
 * and Privacy Policy, once each, TERMS_NOTICE_DAYS before they take effect for
 * them (lib/terms.ts noticePeriod); called from the daily job. Each email is
 * recorded (TermsNotice) just before it's sent, so two runs can't both send
 * it, and taken back if it fails, to be tried again next run. Not to closed
 * accounts: they're signed out, and are told once they keep the account.
 */
export async function sendTermsNotices(budgetMs = 60_000) {
  // Emails every existing account holder, so it waits until the founder switches it on.
  if (process.env.TERMS_NOTICES !== "on") return 0;
  const until = Date.now() + budgetMs;
  const { termsVersion, privacyVersion } = LEGAL;
  const started = await recordsStartedAt();
  const due = await db.$queryRaw<{ id: string; email: string }[]>`
    SELECT u.id, u.email FROM "User" u
    WHERE u."deleteAt" IS NULL
      AND (u."createdAt" < ${started} OR EXISTS (SELECT 1 FROM "TermsAcceptance" t WHERE t."userId" = u.id))
      AND NOT EXISTS (SELECT 1 FROM "TermsAcceptance" t WHERE t."userId" = u.id AND t."termsVersion" = ${termsVersion} AND t."privacyVersion" = ${privacyVersion})
      AND NOT EXISTS (SELECT 1 FROM "TermsNotice" n WHERE n."userId" = u.id AND n."termsVersion" = ${termsVersion} AND n."privacyVersion" = ${privacyVersion})
    ORDER BY u."createdAt" ASC
    LIMIT 500`;
  let sent = 0;
  for (const u of due) {
    if (Date.now() > until) break;
    const sentAt = new Date();
    const claim = await db.termsNotice.create({ data: { userId: u.id, email: u.email, termsVersion, privacyVersion, sentAt } }).catch(() => null);
    if (!claim) continue;
    try {
      const ws = await db.workspace.findFirst({ where: { members: { some: { userId: u.id } } }, orderBy: { createdAt: "asc" }, select: { timezone: true } });
      await sendMail({ to: u.email, ...termsNoticeEmail(new Date(sentAt.getTime() + TERMS_NOTICE_DAYS * 86_400_000), ws?.timezone ?? null) });
      sent++;
    } catch (err) {
      await db.termsNotice.delete({ where: { id: claim.id } }).catch(() => {});
      console.error(JSON.stringify({ level: "error", message: "[terms-notice] couldn't email; retried next run", user: u.id, error: String(err) }));
    }
  }
  return sent;
}
