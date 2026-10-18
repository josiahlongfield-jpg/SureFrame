import { z } from "zod";
import { currentUser, handle, HttpError } from "@/lib/session";
import { activeSupportAgent } from "@/lib/support/admin";
import { canInstall, finishInstall, InstallError, installFile, planInstall } from "@/lib/ai/speechModel";

export const runtime = "nodejs";
// One model file per request; the largest is under 100 MB, copied server to server.
export const maxDuration = 300;

const Body = z.discriminatedUnion("step", [
  z.object({ step: z.literal("plan") }),
  z.object({ step: z.literal("file"), revision: z.string(), name: z.string().max(200) }),
  z.object({ step: z.literal("finish"), revision: z.string() }),
]);

/**
 * Founder-only: installs the speech model for on-device transcripts into our
 * storage, driven step by step from /support/accounts (plan, each file, finish).
 */
export const POST = handle(async (req: Request) => {
  // Not requireUser(): support tools work even while the founder's own workspace is paused or suspended.
  const me = await currentUser();
  if (!me) throw new HttpError(401, "Sign in required");
  if (!(await activeSupportAgent())) throw new HttpError(404, "Not found");
  if (!canInstall()) throw new HttpError(400, "Connect the storage bucket (S3_BUCKET) first: the speech model is too big for the database.");
  const body = Body.safeParse(await req.json());
  if (!body.success) throw new HttpError(400, "Invalid request");
  try {
    const b = body.data;
    if (b.step === "plan") return Response.json(await planInstall());
    if (b.step === "file") return Response.json(await installFile(b.revision, b.name));
    const manifest = await finishInstall(b.revision);
    const bytes = Object.values(manifest.files).reduce((n, f) => n + f.bytes, 0);
    return Response.json({ revision: manifest.revision, files: Object.keys(manifest.files).length, bytes, installedAt: manifest.installedAt });
  } catch (err) {
    if (err instanceof InstallError) throw new HttpError(502, err.message);
    if (err instanceof HttpError) throw err;
    // Usually Hugging Face or our storage couldn't be reached. Say so, rather than "Internal error".
    console.error(JSON.stringify({ level: "error", route: "/api/support/speech-model", message: String((err as Error)?.message ?? err).slice(0, 500) }));
    throw new HttpError(
      502,
      `The download didn't work (${String((err as Error)?.message ?? err).slice(0, 120)}). Usually this server couldn't reach huggingface.co, or the storage bucket refused the file. Nothing was switched on, so any version installed before stays in use. Try again in a few minutes; if it keeps failing, check that the server can reach huggingface.co and that the storage bucket settings (S3_BUCKET) are right.`,
    );
  }
});
