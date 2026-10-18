import { memberOrClient } from "@/lib/access";
import { askForLink } from "@/lib/askForLink";
import { handle, HttpError } from "@/lib/session";

/**
 * A recognised client whose browser no longer has their key (Safari clears
 * site storage after a week or so without a visit, or a new device) asks for
 * their personal link again (lib/askForLink.ts).
 */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const who = await memberOrClient(id);
  if (who.kind !== "client") throw new HttpError(404, "Not found");
  return Response.json({ asked: await askForLink(id) });
});
