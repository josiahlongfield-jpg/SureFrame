import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BRAND } from "@/lib/brand";
import { emailDocument } from "@/lib/emailLook";

/**
 * fromName is for emails to a business's clients only ("Business A via
 * SureFrame"). Emails to the business itself, its staff or anyone signing in
 * come from plain "SureFrame": a business shouldn't get mail from its own name.
 */
export type Mail = { to: string; subject: string; text: string; html: string; fromName?: string; replyTo?: string | null };

/** Sends an email through Resend when RESEND_API_KEY is set, or to the local outbox without it. */
export async function sendMail(mail: Mail) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return toOutbox(mail);
  await resend(key, "/emails", resendBody(mail));
}

/**
 * Several emails at once (sending a video to many clients): one Resend batch
 * request per 100, so a large send isn't slowed or refused by the per-second
 * request limit. Returns how many went out.
 */
export async function sendMails(mails: Mail[]) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    for (const mail of mails) await toOutbox(mail);
    return mails.length;
  }
  let sent = 0;
  for (let i = 0; i < mails.length; i += 100) {
    const chunk = mails.slice(i, i + 100);
    try {
      await resend(key, "/emails/batch", chunk.map(resendBody));
      sent += chunk.length;
    } catch (err) {
      console.error("[mail] batch failed", chunk.length, err);
    }
  }
  return sent;
}

/** A business's emails read "Business A via SureFrame", from our one sending address. */
const fromOf = (mail: Mail) => {
  const name = mail.fromName?.trim();
  return `${displayName(name && name !== BRAND.name ? `${name} via ${BRAND.name}` : BRAND.name)} <${process.env.MAIL_FROM ?? "reminders@example.com"}>`;
};
// Every email goes out as a whole document with a viewport tag, so phones show it at their own width.
const resendBody = (mail: Mail) => ({ from: fromOf(mail), to: [mail.to], subject: mail.subject, text: mail.text, html: emailDocument(mail.html, mail.subject), reply_to: mail.replyTo ?? undefined });

async function resend(key: string, path: string, payload: unknown) {
  const body = JSON.stringify(payload);
  // Resend allows a few requests a second; a burst waits briefly and tries again.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.resend.com${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
    });
    if (res.ok) return;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const wait = Math.min(5, Number(res.headers.get("retry-after")) || 2 ** attempt);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    throw new Error(`Email failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}

/** Without RESEND_API_KEY (local dev, tests) messages are written to .data/outbox so they can be inspected. */
async function toOutbox(mail: Mail) {
  try {
    const dir = join(process.cwd(), ".data", "outbox");
    const tmp = join(process.cwd(), ".data", "outbox-tmp");
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await mkdir(dir, { recursive: true });
    await mkdir(tmp, { recursive: true });
    // Written aside, then moved in whole, so nothing reading the outbox sees half a file.
    await writeFile(join(tmp, name), JSON.stringify({ from: fromOf(mail), ...mail, html: emailDocument(mail.html, mail.subject) }, null, 2));
    await rename(join(tmp, name), join(dir, name));
  } catch {
    // No writable disk (e.g. a hosted preview): log instead.
    console.log("[mail not sent: no RESEND_API_KEY]", JSON.stringify({ to: mail.to, subject: mail.subject }));
  }
}

/**
 * A business name as an email display name. Names with a comma, colon, @ or
 * the like must be quoted, or "Smith, Jones & Co" reads as two addresses.
 */
export function displayName(name: string) {
  const clean = name.replace(/[\r\n"\\<>]/g, "").trim() || BRAND.name;
  return /[()<>\[\]:;@\\,."]/.test(clean) ? `"${clean}"` : clean;
}
