import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { clientBlock, clientCookie, clientGate, REMOVED_COOKIE } from "@/lib/access";
import { replacedLinks } from "@/lib/replacedLinks";

/**
 * A client's personal link. Remembers them on this device (no password or
 * account needed) and opens the requested video or their inbox.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const client = await db.client.findUnique({ where: { token }, include: { workspace: { select: clientGate } } });
  const url = new URL(req.url);
  // A link that opens nothing right now. Their inbox says who and why from a short-lived note (the same one in
  // each case), without remembering them on this device.
  const note = async () =>
    (await cookies()).set(REMOVED_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/inbox", maxAge: 600 });
  if (!client) {
    // An old link the business replaced when it reset its keys (lib/rekey.ts): say so, not "mistyped".
    if ((await replacedLinks([token])).length) {
      await note();
      return Response.redirect(new URL("/inbox?replaced=1", url), 302);
    }
    return Response.redirect(new URL("/inbox?invalid=1", url), 302);
  }
  switch (clientBlock(client)) {
    // The business ended their access; it can still be restored for a while (lib/clientRemoval.ts).
    case "removed":
      await note();
      return Response.redirect(new URL("/inbox?removed=1", url), 302);
    // SureFrame support suspended or closed the business's workspace (lib/support/admin.ts). Clients aren't told why.
    case "unavailable":
      await note();
      return Response.redirect(new URL("/inbox?unavailable=1", url), 302);
    // The business closed its account (lib/accountDeletion.ts).
    case "closed":
      await note();
      return Response.redirect(new URL("/inbox?closed=1", url), 302);
    // SureFrame support turned this client's link off.
    case "off":
      await note();
      return Response.redirect(new URL("/inbox?off=1", url), 302);
    // The business's plan no longer covers this client (lib/seatLimits.ts).
    case "paused":
      return Response.redirect(new URL("/inbox?paused=1", url), 302);
  }

  (await cookies()).set(clientCookie(client.workspaceId), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  const v = url.searchParams.get("v");
  // The browser carries the link's #k=… fragment (the client's key) through this redirect.
  const dest = v && /^[a-z0-9]{6,20}$/.test(v) ? `/v/${v}` : `/inbox?c=${client.id}`;
  return Response.redirect(new URL(dest, url), 302);
}
