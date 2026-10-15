import { brandFill, brandText } from "@/lib/branding";

/**
 * The navy look shared by every email a business or client gets, matching
 * the site. Tables and bgcolor so Outlook keeps the background too.
 */
export const EMAIL = {
  page: "#0c1428",
  card: "#111a31",
  border: "#232d47",
  ink: "#eef2fb",
  body: "#c5cde0",
  muted: "#9aa6c4",
  dim: "#7884a4",
  font: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
};

/** The business's colour, lightened only as far as it needs to show on navy (as on their client pages). */
export function emailColors(color?: string | null) {
  const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
  return { fill: c ? brandFill(c) : "#4a68f2", link: c ? brandText(c) : "#8ea3ff" };
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export const emailButton = (href: string, label: string, fill: string) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="background:${fill};color:#ffffff;text-decoration:none;font-size:15px;padding:11px 20px;border-radius:10px;font-weight:600;display:inline-block">${esc(label)}</a></p>`;

export const emailLogo = (logoUrl: string | null | undefined, alt: string) =>
  logoUrl ? `<p style="margin:0 0 20px"><img src="${esc(logoUrl)}" alt="${esc(alt)}" style="max-height:40px;max-width:200px"></p>` : "";

/** Wraps an email's content in the navy page and card, with the small SureFrame mark underneath. */
export function emailShell(inner: string, footer = "Sent with SureFrame") {
  return `<div style="margin:0;padding:0;background:${EMAIL.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL.page}" style="background:${EMAIL.page}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL.card}" style="max-width:480px;border-collapse:separate;background:${EMAIL.card};border:1px solid ${EMAIL.border};border-radius:16px"><tr><td style="padding:28px 24px;font-family:${EMAIL.font};color:${EMAIL.ink};text-align:left">
${inner}
</td></tr></table>
<p style="font-family:${EMAIL.font};font-size:11px;color:${EMAIL.dim};margin:16px 0 0">${esc(footer)}</p>
</td></tr></table>
</div>`;
}
