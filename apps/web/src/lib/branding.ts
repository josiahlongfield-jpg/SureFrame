import type { CSSProperties } from "react";
import type { Plan } from "@prisma/client";

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_LOGO_BYTES = 300 * 1024;

export type Brand = { name: string; logoUrl: string | null; color: string | null };

type BrandFields = {
  id: string;
  name: string;
  plan: Plan;
  brandColor: string | null;
  brandLogoType: string | null;
  brandVersion: number;
};

export const logoPath = (workspaceId: string, version: number) => `/api/brand/${workspaceId}/logo?v=${version}`;

/**
 * Custom branding is a paid feature; on Free it is kept but not shown.
 * Pass `origin` (e.g. https://sureframe.app) for emails, which need absolute URLs.
 */
export function brandOf(w: BrandFields, origin = ""): Brand {
  const paid = w.plan !== "FREE";
  return {
    name: w.name,
    logoUrl: paid && w.brandLogoType ? origin + logoPath(w.id, w.brandVersion) : null,
    color: paid ? w.brandColor : null,
  };
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (c: string, to: number, amount: number) => toHex(hex(c).map((v) => v + (to - v) * amount));

function luminance(c: string) {
  const [r, g, b] = hex(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Buttons put white text on the brand colour, so it must be dark enough to read (WCAG 3:1). */
export function colorProblem(c: string): string | null {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return "Use a colour like #1f7a5c.";
  if (1.05 / (luminance(c) + 0.05) < 3) return "That colour is too light for white button text. Pick a darker shade.";
  return null;
}

/** Override the app's brand colour tokens for everything inside an element. */
export function brandStyle(color: string | null): CSSProperties | undefined {
  if (!color) return undefined;
  // Buttons and bubbles: visible against the navy page (2:1), but still dark enough for their white text.
  const fill = contrast(color, NAVY) >= 2 ? color : lightenFor(color, NAVY, 2, 0.35);
  // Links and highlights sit on cards, so they need reading contrast (4.5:1).
  const text = lightenFor(color, NAVY_SURFACE, 4.5);
  return {
    "--color-brand-50": mix(color, 255, 0.92),
    "--color-brand-100": mix(color, 255, 0.84),
    "--color-brand-500": mix(color, 255, 0.12),
    "--color-brand-600": color,
    "--color-brand-700": mix(color, 0, 0.18),
    "--color-brand-900": mix(color, 0, 0.55),
    // Client pages are navy (globals.css): the same colour, lightened only as far as it needs to show up there.
    "--brand-fill": fill,
    "--brand-fill-hover": mix(fill, 255, 0.12),
    "--brand-text": text,
    "--brand-soft": rgba(fill, 0.18),
    "--brand-line": rgba(text, 0.4),
  } as CSSProperties;
}

const NAVY = "#0c1428";
const NAVY_SURFACE = "#111a31";
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const rgba = (c: string, a: number) => `rgb(${hex(c).join(" ")} / ${a})`;

/** The least mix towards white that gives `min` contrast against `bg` (stopping before the colour washes out). */
function lightenFor(c: string, bg: string, min: number, max = 0.85) {
  for (let t = 0; t <= max; t += 0.05) {
    const m = mix(c, 255, t);
    if (contrast(m, bg) >= min) return m;
  }
  return mix(c, 255, max);
}
