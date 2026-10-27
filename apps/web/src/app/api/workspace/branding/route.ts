import { db } from "@/lib/db";
import { colorProblem, LOGO_TYPES, MAX_LOGO_BYTES } from "@/lib/branding";
import { limitByIp } from "@/lib/rateLimit";
import { handle, HttpError, requireRole, requireUser } from "@/lib/session";

/** Save custom branding: multipart form with optional `logo` file, `color`, and `removeLogo`. */
export const POST = handle(async (req: Request) => {
  const me = await requireUser();
  requireRole(me, "OWNER", "ADMIN");
  const { workspace } = me;
  if (workspace.plan === "FREE") throw new HttpError(402, "Custom branding is part of every paid plan.");

  // Refuse an oversized upload before reading it.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_LOGO_BYTES + 64 * 1024) throw new HttpError(413, "That image is too big. Use one under 300 KB.");
  await limitByIp("branding", 30, 600);
  const form = await req.formData().catch(() => null);
  if (!form) throw new HttpError(400, "Invalid request");
  const data: { brandColor?: string | null; brandLogo?: Uint8Array<ArrayBuffer> | null; brandLogoType?: string | null } = {};

  const color = String(form.get("color") ?? "").trim().toLowerCase();
  if (color) {
    const problem = colorProblem(color);
    if (problem) throw new HttpError(400, problem);
    data.brandColor = color;
  } else if (form.has("color")) data.brandColor = null;

  const logo = form.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (!(LOGO_TYPES as readonly string[]).includes(logo.type)) throw new HttpError(400, "Upload a PNG, JPG or WebP image.");
    if (logo.size > MAX_LOGO_BYTES) throw new HttpError(413, "That image is too big. Use one under 300 KB.");
    data.brandLogo = new Uint8Array(await logo.arrayBuffer());
    data.brandLogoType = logo.type;
  } else if (form.get("removeLogo") === "1") {
    data.brandLogo = null;
    data.brandLogoType = null;
  }

  const w = await db.workspace.update({
    where: { id: workspace.id },
    data: { ...data, brandVersion: { increment: 1 } },
    select: { brandColor: true, brandLogoType: true, brandVersion: true },
  });
  return Response.json({ color: w.brandColor, hasLogo: !!w.brandLogoType, version: w.brandVersion });
});
