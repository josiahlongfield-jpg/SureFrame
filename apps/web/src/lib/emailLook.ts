import { appUrl } from "@/lib/appUrl";
import { brandText } from "@/lib/branding";

/**
 * The Fresh look shared by every email a business or client gets, matching
 * the site: a white card on warm white, navy text. Tables and bgcolor so
 * Outlook keeps the background too.
 */
export const EMAIL = {
  page: "#f3efea",
  card: "#ffffff",
  border: "#ece4dc",
  ink: "#0f2747",
  body: "#33465f",
  muted: "#57687e",
  dim: "#5e6e84",
  font: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
};

/** The business's colour with white text (as on their client pages), or SureFrame coral with navy text. */
export function emailColors(color?: string | null) {
  const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
  return c ? { fill: c, on: "#ffffff", link: brandText(c) } : { fill: "#ff6f61", on: "#0f2747", link: "#b8402c" };
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const emailButton = (href: string, label: string, { fill, on }: { fill: string; on: string }) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="background:${fill};color:${on};text-decoration:none;font-size:15px;padding:11px 20px;border-radius:10px;font-weight:600;display:inline-block">${esc(label)}</a></p>`;

/**
 * The small SureFrame mark: the logo's navy tile (public/brand/email-mark.png, drawn by scripts/brand-assets.mjs,
 * so dark-mode mail apps can't recolour it) and the wordmark as text, which still shows when images are blocked.
 * In-app previews load the tile from the page's own address.
 */
export const emailMark = (margin = "0 0 20px") =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${margin}"><tr>` +
  `<td width="24" height="24" style="width:24px;height:24px;line-height:0"><img src="${typeof window === "undefined" ? appUrl() : window.location.origin}/brand/email-mark.png" width="24" height="24" alt="" style="display:block;width:24px;height:24px;border:0;border-radius:6px"></td>` +
  `<td style="padding-left:8px;font-family:${EMAIL.font};font-size:17px;line-height:24px;color:${EMAIL.ink};letter-spacing:-0.02em"><span style="font-weight:700">Sure</span><span style="font-weight:200">Frame</span></td>` +
  `</tr></table>`;

/** The business's logo on branded emails, otherwise the SureFrame mark, so every email has a recognisable top. */
export const emailLogo = (logoUrl: string | null | undefined, alt: string) =>
  logoUrl ? `<p style="margin:0 0 20px"><img src="${esc(logoUrl)}" alt="${esc(alt)}" style="max-height:40px;max-width:200px"></p>` : emailMark();

/**
 * A whole HTML document around an email, with a viewport tag, so a phone
 * shows it at its own width instead of a zoomed-out desktop page. lib/mail.ts
 * wraps every email in it.
 */
export const emailDocument = (html: string, title: string) =>
  /^\s*<!doctype/i.test(html)
    ? html
    : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;padding:0">${html}</body></html>`;

/** Wraps an email's content in the page and card (topped with the button colour), with a small line of text underneath ("Sent with SureFrame" unless given). */
export function emailShell(inner: string, footer = "Sent with SureFrame", accent = "#ff6f61") {
  return `<div style="margin:0;padding:0;background:${EMAIL.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL.page}" style="background:${EMAIL.page}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL.card}" style="max-width:480px;border-collapse:separate;background:${EMAIL.card};border:1px solid ${EMAIL.border};border-top:3px solid ${accent};border-radius:16px"><tr><td style="padding:28px 24px;font-family:${EMAIL.font};color:${EMAIL.ink};text-align:left">
${inner}
</td></tr></table>
<p style="font-family:${EMAIL.font};font-size:12px;color:${EMAIL.dim};margin:16px 0 0">${esc(footer)}</p>
</td></tr></table>
</div>`;
}
