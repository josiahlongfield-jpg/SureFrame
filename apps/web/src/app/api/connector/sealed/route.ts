import { connectorCaller, ConnectorDenied, logUse } from "@/lib/connector/grants";
import { sealedQuery } from "@/lib/connector/sealed";
import { ToolInputError } from "@/lib/connector/tools";
import { rateLimit } from "@/lib/rateLimit";
import { handle, HttpError } from "@/lib/session";

/**
 * Encrypted content for the desktop connector (lib/connector/sealed.ts), which unlocks it on the person's
 * own computer. Desktop connection tokens only.
 */
export const dynamic = "force-dynamic";

/** The desktop connector's own tools that read through here (apps/connector/src/server/index.js). */
const SEALED_TOOLS = new Set(["read_client", "read_todos", "read_notes", "read_conversation", "search_text"]);

export const POST = handle(async (req: Request) => {
  let caller;
  try {
    caller = await connectorCaller(req, ["desktop"]);
  } catch (err) {
    if (err instanceof ConnectorDenied) throw new HttpError(err.expired ? 401 : 403, err.message);
    throw err;
  }
  const q = (await req.json()) as Record<string, unknown>;
  if (!q || typeof q !== "object" || Array.isArray(q)) throw new HttpError(400, "Invalid request");
  await rateLimit(`connector:${caller.grant.id}`, 600, 3600);
  // Every request is logged (B13), not only ones naming a tool: Claude Desktop names the tool it's answering;
  // anything else that reads content shows as "direct", and its key checks as "keys".
  await logUse(caller.grant.id, typeof q.tool === "string" && SEALED_TOOLS.has(q.tool) ? q.tool : q.query === "keys" ? "keys" : "direct");
  try {
    return Response.json(await sealedQuery(caller.access, q), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ToolInputError) throw new HttpError(400, err.message);
    throw err;
  }
});
