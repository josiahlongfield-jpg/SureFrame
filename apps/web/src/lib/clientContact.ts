import { z } from "zod";

/**
 * A business's optional contact line for its own clients (Decision 5): an email address, a phone number or both,
 * set under Settings > Branding on every plan. Shown on the client's pages, in the client help chat's can't-answer
 * and error replies, and in emails to clients. Left blank, nothing shows.
 */
export type ClientContact = { email: string | null; phone: string | null };

export const CONTACT_EMAIL_MAX = 200;
export const CONTACT_PHONE_MAX = 30;

/** Digits, spaces, a leading +, brackets, dots and dashes, with 6 to 15 digits (the most a phone number has). */
export function phoneProblem(phone: string): string | null {
  const p = phone.trim();
  if (!p) return null;
  if (p.length > CONTACT_PHONE_MAX || !/^\+?[0-9 ().-]+$/.test(p)) return "Enter a phone number using digits, spaces and a leading + only.";
  const digits = p.replace(/\D/g, "").length;
  if (digits < 6 || digits > 15) return "That phone number doesn't look complete.";
  return null;
}

/** The same rule the browser's email boxes use, kept short. */
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
export function emailProblem(email: string): string | null {
  const e = email.trim();
  if (!e) return null;
  if (e.length > CONTACT_EMAIL_MAX || !EMAIL.test(e)) return "That email address doesn't look right.";
  return null;
}

/** For the settings API: blank clears it, anything else must be valid. */
export const ContactFields = {
  contactEmail: z.string().max(CONTACT_EMAIL_MAX).refine((v) => !emailProblem(v), "That contact email address doesn't look right.").optional(),
  contactPhone: z.string().max(CONTACT_PHONE_MAX).refine((v) => !phoneProblem(v), "That contact phone number doesn't look right. Use digits, spaces and a leading + only.").optional(),
};

/** Tidied for saving: spaces collapsed, blank as null. */
export const tidyContact = (v: string | undefined) => (v === undefined ? undefined : v.replace(/\s+/g, " ").trim() || null);

export function contactOf(w: { contactEmail?: string | null; contactPhone?: string | null }): ClientContact | null {
  const email = w.contactEmail?.trim() || null;
  const phone = w.contactPhone?.trim() || null;
  return email || phone ? { email, phone } : null;
}

/** "tel:" address: digits and a leading +. */
export const telHref = (phone: string) => `tel:${phone.trim().startsWith("+") ? "+" : ""}${phone.replace(/\D/g, "")}`;

/** "at hello@business.com or on 0400 000 000", for a sentence ("Please contact Business A …"). */
export function contactWords(c: ClientContact) {
  return [c.email ? `at ${c.email}` : null, c.phone ? `on ${c.phone}` : null].filter(Boolean).join(" or ");
}

/**
 * The line near the end of an email to a client about reaching the business: "Please don't reply to this email;
 * contact Business A at … ." when replies go nowhere, else just its contact line when it set one. Null when there's
 * nothing to say.
 */
export function clientEmailContact(business: string, contact: ClientContact | null | undefined, noReply?: boolean) {
  const words = contact ? contactWords(contact) : "";
  if (noReply) return `Please don't reply to this email; contact ${business} ${words || "directly"}.`;
  return words ? `Contact ${business} ${words}.` : null;
}
