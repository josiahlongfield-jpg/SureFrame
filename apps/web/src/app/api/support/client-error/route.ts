import { loggablePath } from "@/lib/clientError";
import { limitByIp } from "@/lib/rateLimit";

const FIELDS = ["where", "name", "message", "stack", "url", "ua"] as const;

/**
 * Browser-side errors (help chat, uploads, AI transcripts, page crashes),
 * written to the logs for diagnosis. Only the expected fields are kept, as one
 * JSON line, so nobody can write made-up log lines through it.
 */
export async function POST(req: Request) {
  try {
    await limitByIp("client-error", 20, 3600);
    const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (raw && typeof raw === "object") {
      const entry = Object.fromEntries(FIELDS.flatMap((k) => (raw[k] == null ? [] : [[k, String(raw[k]).slice(0, k === "stack" ? 1500 : 500)]])));
      // The browser already leaves invite, client-link and offer secrets out of the path; a page loaded before that
      // change still sends them, so they're taken out here too.
      if (entry.url) entry.url = loggablePath(entry.url);
      console.log("[support] client error", JSON.stringify(entry));
    }
  } catch {}
  return new Response(null, { status: 204 });
}
