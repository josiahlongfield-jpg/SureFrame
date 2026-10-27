import { z } from "zod";
import { aiAssistActive } from "@/lib/plans";
import { aiConfigured, MAX_TRANSCRIPT_CHARS, reserveSummary, summarise } from "@/lib/ai/summary";
import { handle, HttpError, requireUser } from "@/lib/session";
import { accessOf, visibleVideo } from "@/lib/permissions";
import { rateLimit } from "@/lib/rateLimit";

export const maxDuration = 120;

const Body = z.object({ transcript: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS) });

/**
 * AI summaries add-on: turns a transcript made on the team member's device
 * into a short summary. Team members only (clients never trigger AI), and only
 * for workspaces with the add-on on. The transcript and summary pass through
 * memory only: they are not logged or stored here. The browser encrypts the
 * result with the video's key before saving it.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const me = await requireUser();
  const video = await visibleVideo(accessOf(me), id);
  if (video.replyToId) throw new HttpError(404, "Video not found");
  if (!aiAssistActive(me.workspace)) throw new HttpError(403, "AI summaries aren't switched on for this business");
  if (!aiConfigured()) throw new HttpError(503, "AI summaries aren't available right now. Please try again later.");
  await rateLimit(`ai-summary:${me.workspace.id}`, 30, 600);
  const body = Body.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "The transcript is empty or too long to summarise");

  const undo = await reserveSummary(me.workspace);
  try {
    return Response.json({ summary: await summarise(body.data.transcript) });
  } catch (err) {
    await undo().catch(() => {});
    if (err instanceof HttpError) throw err;
    // Log only the error type, never the request (it holds the transcript).
    console.error("[ai] summary failed", (err as Error)?.name, (err as { status?: number })?.status ?? "");
    throw new HttpError(502, "Couldn't write the summary just now. Please try again.");
  }
});
