import { connectorCaller, ConnectorDenied, logUse, type ConnectorCaller } from "@/lib/connector/grants";
import { resourceMetadataUrl, SCOPE } from "@/lib/connector/oauth";
import { ToolInputError, toolsFor } from "@/lib/connector/tools";
import { rateLimit } from "@/lib/rateLimit";
import { HttpError } from "@/lib/session";

/**
 * The SureFrame connector for Claude (Model Context Protocol, Streamable HTTP, stateless): sureframe.app/mcp.
 * Every request carries a connector token (lib/connector/grants.ts); the tools are read-only activity
 * (lib/connector/tools.ts). No sessions or server-sent events: each POST is answered with one JSON response.
 */
export const dynamic = "force-dynamic";

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER = { name: "sureframe", title: "SureFrame", version: "1.0.0" };
const INSTRUCTIONS =
  "SureFrame is a private video messaging tool businesses use with their clients. These tools read the signed-in person's activity in one team, " +
  "for the clients they can see: videos sent and opened, replies waiting, quiet clients and to-do due dates. They can't send, change or delete anything. " +
  "Messages, replies, to-dos, notes and transcripts are end-to-end encrypted and aren't available here. Start with get_overview.";

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: Record<string, unknown> };
type RpcError = { code: number; message: string };

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Protocol-Version" };

const signIn = (error?: { code: string; description: string }) =>
  new Response(JSON.stringify({ error: error?.code ?? "unauthorized", error_description: error?.description ?? "Sign in required" }), {
    status: 401,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl()}", scope="${SCOPE}"${error ? `, error="${error.code}", error_description="${error.description.replace(/"/g, "'")}"` : ""}`,
    },
  });

const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const rpcError = (id: RpcRequest["id"], error: RpcError) => ({ jsonrpc: "2.0", id: id ?? null, error });

async function answer(caller: ConnectorCaller, msg: RpcRequest) {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") return rpcError(msg?.id, { code: -32600, message: "Invalid request" });
  const isNotification = msg.id === undefined;
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};
  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : VERSIONS[0];
      return rpcResult(msg.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, {
        tools: toolsFor(caller.access).map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = toolsFor(caller.access).find((t) => t.name === name);
      if (!tool) return rpcError(msg.id, { code: -32602, message: `Unknown tool: ${name}` });
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
      await rateLimit(`connector:${caller.grant.id}`, 600, 3600);
      await logUse(caller.grant.id, tool.name);
      try {
        const result = await tool.run(caller.access, args, new Date());
        return rpcResult(msg.id, { content: [{ type: "text", text: JSON.stringify(result) }] });
      } catch (err) {
        if (err instanceof ToolInputError) return rpcResult(msg.id, { content: [{ type: "text", text: err.message }], isError: true });
        throw err;
      }
    }
    default:
      if (isNotification || msg.method.startsWith("notifications/")) return null;
      return rpcError(msg.id, { code: -32601, message: `Method not found: ${msg.method}` });
  }
}

export async function POST(req: Request) {
  let caller: ConnectorCaller;
  try {
    caller = await connectorCaller(req, ["online", "desktop"]);
  } catch (err) {
    if (!(err instanceof ConnectorDenied)) throw err;
    if (!req.headers.get("authorization")) return signIn();
    if (err.expired) return signIn({ code: "invalid_token", description: err.message });
    return Response.json(rpcError(null, { code: -32001, message: err.message }), { status: 403, headers: CORS });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(rpcError(null, { code: -32700, message: "Parse error" }), { status: 400, headers: CORS });
  }
  try {
    const batch = Array.isArray(body);
    const msgs = (batch ? body : [body]) as RpcRequest[];
    if (!msgs.length || msgs.length > 20) return Response.json(rpcError(null, { code: -32600, message: "Invalid request" }), { status: 400, headers: CORS });
    const out = [];
    for (const m of msgs) {
      const r = await answer(caller, m);
      if (r && m?.id !== undefined) out.push(r);
    }
    // Only notifications or responses: nothing to say back.
    if (!out.length) return new Response(null, { status: 202, headers: CORS });
    return Response.json(batch ? out : out[0], { headers: CORS });
  } catch (err) {
    if (err instanceof HttpError) {
      const id = Array.isArray(body) ? null : (body as RpcRequest)?.id;
      return Response.json(rpcError(id, { code: -32000, message: err.message }), { status: err.status === 429 ? 429 : 200, headers: CORS });
    }
    throw err;
  }
}

/** No server-to-client stream: everything is answered on the POST. */
export const GET = () => new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
export const DELETE = GET;

export const OPTIONS = () =>
  new Response(null, {
    status: 204,
    headers: { ...CORS, "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id" },
  });
