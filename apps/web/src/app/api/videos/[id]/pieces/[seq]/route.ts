import { after } from "next/server";
import { z } from "zod";
import { storage } from "@/lib/storage";
import { handle, HttpError } from "@/lib/session";
import { uploadableVideo } from "@/lib/videos";
import { joinParts, MAX_PIECE_BYTES, partReady, pieceKey, registerPiece } from "@/lib/pieces";

/**
 * One piece of a recording, sent as it's made (lib/pieces.ts). Idempotent: a piece sent again after a crash or a
 * dropped connection replaces the earlier copy. `seq` counts from 0; `offset` is where it starts in the recording.
 */

const Presign = z.object({ offset: z.number().int().min(0), size: z.number().int().min(1).max(MAX_PIECE_BYTES), durationMs: z.number().min(0).optional() });

/** With object storage, the browser stores the piece straight in the bucket: this returns a short-lived URL for it. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string; seq: string }> }) => {
  const { id, seq } = await ctx.params;
  const body = Presign.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new HttpError(body.error.issues.some((i) => i.code === "too_big") ? 413 : 400, "Bad piece");
  const video = await uploadableVideo(req, id);
  const n = Number(seq);
  if (!(await registerPiece(video, n, body.data.offset, body.data.size, body.data.durationMs ?? 0))) return Response.json({ url: null, joined: true });
  // Earlier pieces are stored by now (the recorder sends them in order): join any whole part they make.
  if (partReady(video, body.data.offset, body.data.size)) after(() => joinParts(id).catch((err) => console.error(JSON.stringify({ level: "error", where: "joinParts", videoId: id, message: String(err?.message ?? err) }))));
  const driver = storage();
  return Response.json({ url: driver.presignObject ? await driver.presignObject(pieceKey(id, n), body.data.size) : null });
});

/** Without object storage (or when asked), the piece comes through here. */
export const PUT = handle(async (req: Request, ctx: { params: Promise<{ id: string; seq: string }> }) => {
  const { id, seq } = await ctx.params;
  const url = new URL(req.url);
  const offset = Number(url.searchParams.get("offset"));
  const durationMs = Number(url.searchParams.get("ms") ?? "0");
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_PIECE_BYTES) throw new HttpError(413, "Piece too large");
  const video = await uploadableVideo(req, id);
  const bytes = new Uint8Array(await req.arrayBuffer());
  const n = Number(seq);
  if (!(await registerPiece(video, n, offset, bytes.length, durationMs))) return Response.json({ seq: n, size: bytes.length, joined: true });
  await storage().putObject(pieceKey(id, n), bytes, "application/octet-stream");
  if (partReady(video, offset, bytes.length)) after(() => joinParts(id).catch((err) => console.error(JSON.stringify({ level: "error", where: "joinParts", videoId: id, message: String(err?.message ?? err) }))));
  return Response.json({ seq: n, size: bytes.length });
});
