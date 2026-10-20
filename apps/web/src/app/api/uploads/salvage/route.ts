import { z } from "zod";
import { auth } from "@/auth";
import { handle, HttpError } from "@/lib/session";
import { salvageFor } from "@/lib/pieces";

const Body = z.object({ local: z.array(z.string().max(40)).max(200) });

/**
 * Finishes recordings this person left unfinished somewhere else, from the server's copy (lib/pieces.ts). Called by
 * every page that recovers recordings (lib/recorder/uploader.ts recoverInterrupted), with the ones this browser
 * still holds, which it finishes itself.
 */
export const POST = handle(async (req: Request) => {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new HttpError(400, "Invalid request");
  const userId = (await auth())?.user?.id ?? null;
  return Response.json(await salvageFor(userId, body.data.local));
});
