import { z } from "zod";
import { handle, HttpError } from "@/lib/session";
import { publicVideo, uploadableVideo } from "@/lib/videos";
import { completeUpload } from "@/lib/uploadComplete";
import { finishFromPieces } from "@/lib/pieces";

const Body = z.union([
  // The web recorder: it sent pieces, which the server joins into parts (lib/pieces.ts).
  z.object({ pieces: z.literal(true), durationMs: z.number().int().min(0) }),
  // Uploads that send their own parts (the phone app, and recordings begun before pieces).
  z.object({ partCount: z.number().int().min(1).max(10_000), durationMs: z.number().int().min(0) }),
]);

/** Finish the upload. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "Invalid request");
  const video = await uploadableVideo(req, id);
  try {
    if ("pieces" in body.data) {
      return Response.json({ video: publicVideo(await finishFromPieces(video, body.data.durationMs)) });
    }
    return Response.json({ video: publicVideo(await completeUpload(video, body.data.partCount, body.data.durationMs)) });
  } catch (err) {
    const missing = (err as { missing?: number[] }).missing;
    if (err instanceof HttpError && missing) return Response.json({ error: err.message, missing }, { status: 409 });
    throw err;
  }
});
