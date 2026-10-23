import { z } from "zod";
import { bellCount, bellFor, markRead } from "@/lib/notifications";
import { handle, HttpError, requireUser } from "@/lib/session";

/** The bell in the top menu (lib/notifications.ts): the latest notifications, or (?count=1) just how many are unread. */
export const GET = handle(async (req: Request) => {
  const me = await requireUser();
  const countOnly = new URL(req.url).searchParams.get("count") === "1";
  return Response.json(countOnly ? await bellCount(me.user.id, me.workspace.id) : await bellFor(me.user.id, me.workspace.id));
});

const Read = z.union([z.object({ id: z.string().min(1).max(40) }), z.object({ videoId: z.string().min(1).max(40) }), z.object({ all: z.literal(true) })]);

/** Marks one notification read, those about one conversation (opened on the video page), or all of them. */
export const POST = handle(async (req: Request) => {
  const me = await requireUser();
  const body = Read.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new HttpError(400, "Say which notifications to mark read");
  const read = await markRead(me.user.id, me.workspace.id, body.data);
  return Response.json({ read, ...(await bellCount(me.user.id, me.workspace.id)) });
});
