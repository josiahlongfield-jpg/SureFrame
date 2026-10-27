import { handle, HttpError } from "@/lib/session";
import { currentSupportAdmin, exportUserData } from "@/lib/support/admin";

/**
 * Support admins only: downloads an account's data (lib/support/admin.ts exportUserData) from the console's
 * "Download their data" form. Same-site form posts only, so another site can't make an admin's browser fetch it.
 */
export const POST = handle(async (req: Request) => {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(404, "Not found");
  const admin = await currentSupportAdmin();
  if (!admin) throw new HttpError(404, "Not found");
  const form = await req.formData().catch(() => null);
  if (!form) throw new HttpError(400, "Invalid request");
  const { data } = await exportUserData(admin, { userId: String(form.get("userId") ?? ""), reason: String(form.get("reason") ?? "") });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="sureframe-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
