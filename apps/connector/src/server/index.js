// SureFrame desktop connector for Claude: a local MCP server (stdio) that Claude Desktop runs on the person's
// own computer. It holds their connection code (a SureFrame access token plus their team key, kept in the
// computer's keychain by Claude Desktop), asks SureFrame for the encrypted to-dos, notes, messages, replies and
// summaries the person can see, and unlocks them here. SureFrame's servers never get the key.
//
// No dependencies: Node's built-in Web Crypto and fetch, newline-delimited JSON-RPC on stdin/stdout.
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const VERSION = "1.0.0";
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const subtle = globalThis.crypto.subtle;
const KEY_CHECK_MS = 5 * 60_000;
const log = (...a) => console.error("[sureframe]", ...a);

// ---------- connection code ----------

/** "sfc1_" + base64url(JSON {u: site address, t: access token, k: team key}). Made in SureFrame > Settings > Connections. */
export function parseCode(code) {
  const text = String(code ?? "").trim();
  if (!text.startsWith("sfc1_")) throw new Error("That isn't a SureFrame connection code. Make one in SureFrame under Settings > Connections.");
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromB64url(text.slice(5))));
  } catch {
    throw new Error("That connection code is incomplete. Copy the whole code again from SureFrame.");
  }
  if (typeof parsed?.u !== "string" || typeof parsed?.t !== "string" || typeof parsed?.k !== "string") throw new Error("That connection code is incomplete. Copy the whole code again from SureFrame.");
  const url = new URL(parsed.u);
  if (url.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) throw new Error("That connection code points somewhere other than SureFrame.");
  return { base: url.origin, token: parsed.t, key: parsed.k };
}

// ---------- crypto (the same as apps/web/src/lib/e2e/crypto.ts) ----------

const ALG = { name: "AES-GCM", length: 256 };
const IV_BYTES = 12;

export function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}
export function fromB64url(text) {
  return new Uint8Array(Buffer.from(text, "base64url"));
}
export async function importKey(text) {
  const raw = fromB64url(text.trim());
  if (raw.length !== 32) throw new Error("That key isn't valid");
  return subtle.importKey("raw", raw, ALG, true, ["encrypt", "decrypt"]);
}
export async function fingerprint(key) {
  const raw = new Uint8Array(await subtle.exportKey("raw", key));
  return b64url(new Uint8Array(await subtle.digest("SHA-256", raw))).slice(0, 22);
}
async function open(sealed, key) {
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: sealed.subarray(0, IV_BYTES) }, key, sealed.subarray(IV_BYTES)));
}
export async function unwrapKey(wrapped, key) {
  return subtle.importKey("raw", await open(fromB64url(wrapped), key), ALG, true, ["encrypt", "decrypt"]);
}
export async function decryptText(sealed, key) {
  return new TextDecoder().decode(await open(fromB64url(sealed), key));
}

/** After a key reset, follow the chain from the key in the code to the current one (lib/e2e/keystore.ts). */
export async function followRotations(key, chain) {
  if (!chain.fingerprint) return key;
  let current = key;
  for (let i = 0; i <= chain.rotations.length; i++) {
    const fp = await fingerprint(current);
    if (fp === chain.fingerprint) return current;
    const step = chain.rotations.find((r) => r.from === fp);
    if (!step) return null;
    current = await unwrapKey(step.wrap, current);
  }
  return null;
}

// ---------- SureFrame ----------

class UserError extends Error {}

export function makeConnector(code, { fetchImpl = fetch } = {}) {
  const conn = parseCode(code);
  let teamKey = null;
  const wrapped = new Map();

  async function call(path, body) {
    let res;
    try {
      res = await fetchImpl(conn.base + path, {
        method: "POST",
        headers: { Authorization: `Bearer ${conn.token}`, "Content-Type": "application/json", Accept: "application/json", "User-Agent": `SureFrame-Desktop-Connector/${VERSION}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new UserError("Couldn't reach SureFrame. Check the internet connection and try again.");
    }
    const data = await res.json().catch(() => null);
    const said = data?.error_description ?? (typeof data?.error === "string" ? data.error : data?.error?.message);
    if (res.status === 401) throw new UserError(`${said ?? "This connection has been disconnected."} Make a new connection code in SureFrame under Settings > Connections.`);
    if (!res.ok) throw new UserError(said ?? `SureFrame couldn't answer (${res.status}). Try again in a moment.`);
    return data;
  }

  let checkedAt = 0;
  /** The current team key: checked against SureFrame every few minutes, so a key reset while Claude Desktop is open is followed. */
  async function key() {
    if (teamKey && Date.now() - checkedAt < KEY_CHECK_MS) return teamKey;
    const chain = await call("/api/connector/sealed", { query: "keys" });
    const start = teamKey ?? (await importKey(conn.key).catch(() => null));
    let current = start && (await followRotations(start, chain).catch(() => null));
    if (!current && teamKey) current = await followRotations(await importKey(conn.key), chain).catch(() => null);
    if (!current) throw new UserError("Your team's keys were reset since this connection code was made, so it can't unlock anything. Make a new connection code in SureFrame under Settings > Connections.");
    if (current !== teamKey) wrapped.clear();
    teamKey = current;
    checkedAt = Date.now();
    return teamKey;
  }

  async function unwrapOnce(wrap, parent) {
    if (!wrap) return null;
    if (!wrapped.has(wrap)) wrapped.set(wrap, unwrapKey(wrap, parent).catch(() => null));
    return wrapped.get(wrap);
  }

  const LOCKED = "[couldn't unlock this]";
  async function openWith(sealed, k) {
    if (!sealed) return null;
    if (!k) return LOCKED;
    return decryptText(sealed, k).catch(() => LOCKED);
  }

  async function openItem(i) {
    const team = await key();
    const k = i.key === "team" ? team : await unwrapOnce(i.key?.client_wrap, team);
    const { sealed, key: _k, ...rest } = i;
    return { ...rest, text: await openWith(sealed, k) };
  }

  async function openConversation(c, { transcript = false } = {}) {
    const team = await key();
    const vk = await unwrapOnce(c.video_wrap, team);
    const { video_wrap: _w, message, replies, summary, ...rest } = c;
    const out = {
      ...rest,
      message: await openWith(message, vk),
      replies: await Promise.all(
        replies.map(async (r) => ({ from: r.from, kind: r.kind, at: r.at, text: r.text ?? (r.sealed ? await openWith(r.sealed, vk) : r.kind === "text" ? null : `(${r.kind} reply)`) })),
      ),
    };
    if (summary) {
      const s = summary.sealed_summary ? await openWith(summary.sealed_summary, vk) : null;
      out.summary = s && s !== LOCKED ? safeJson(s) : s;
      if (transcript && summary.sealed_transcript) {
        const t = safeJson(await openWith(summary.sealed_transcript, vk));
        out.transcript = Array.isArray(t?.segments) ? t.segments.map((x) => x.text).join(" ").replace(/\s+/g, " ").trim() : t;
      }
    }
    return out;
  }

  return { call, key, openItem, openConversation, conn };
}

const safeJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

// ---------- tools ----------

const NOTE = "Unlocked on this computer with your team key. SureFrame's servers can't read this.";

const LOCAL_TOOLS = [
  {
    name: "read_client",
    title: "Read a client's notes and conversations",
    description:
      "One client's to-dos and notes with their text, and their recent conversations: each video's message, the replies written back and forth, and the AI summary if there is one. Unlocked on this computer. Pass the client's name or id.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string", description: "The client's name (or part of it) or id." },
        days: { type: "integer", minimum: 1, maximum: 365, description: "How many days of conversations (default 90)." },
      },
      required: ["client"],
      additionalProperties: false,
    },
    async run(c, args) {
      const data = await c.call("/api/connector/sealed", { tool: "read_client", query: "client", client: args.client, days: args.days });
      return {
        client: { id: data.client.id, name: data.client.name, looked_after_by: data.client.looked_after_by },
        todos: await Promise.all(data.items.filter((i) => i.kind === "todo").map(c.openItem)),
        notes: await Promise.all(data.items.filter((i) => i.kind === "note").map(c.openItem)),
        conversations: await Promise.all(data.conversations.map((v) => c.openConversation(v))),
        note: NOTE,
      };
    },
  },
  {
    name: "read_todos",
    title: "Read to-dos",
    description: "Open to-dos with their text and due dates, on the business's own list and the clients this person can see. Unlocked on this computer.",
    inputSchema: {
      type: "object",
      properties: {
        range: { type: "string", enum: ["overdue", "today", "week", "all"], description: "Overdue, due in the next 24 hours, due in the next 7 days (includes overdue), or every open to-do (default week)." },
        client: { type: "string", description: "Only this client's to-dos (name or id)." },
      },
      additionalProperties: false,
    },
    async run(c, args) {
      const data = await c.call("/api/connector/sealed", { tool: "read_todos", query: "items", kind: "todo", range: args.range ?? "week", client: args.client });
      return { count: data.items.length, todos: await Promise.all(data.items.map(c.openItem)), note: NOTE };
    },
  },
  {
    name: "read_notes",
    title: "Read notes",
    description: "Notes with their text, on the business's own list and the clients this person can see, or one client's. Unlocked on this computer.",
    inputSchema: {
      type: "object",
      properties: { client: { type: "string", description: "Only this client's notes (name or id)." } },
      additionalProperties: false,
    },
    async run(c, args) {
      const data = await c.call("/api/connector/sealed", { tool: "read_notes", query: "items", kind: "note", client: args.client });
      return { count: data.items.length, notes: await Promise.all(data.items.map(c.openItem)), note: NOTE };
    },
  },
  {
    name: "read_conversation",
    title: "Read a video's conversation",
    description:
      "One video's message, every reply written back and forth, and its AI summary (and transcript if asked). Unlocked on this computer. Get the video's id from list_videos or get_client_activity.",
    inputSchema: {
      type: "object",
      properties: {
        video: { type: "string", description: "The video's id." },
        include_transcript: { type: "boolean", description: "Also include the full transcript, if one was made (long)." },
      },
      required: ["video"],
      additionalProperties: false,
    },
    async run(c, args) {
      const data = await c.call("/api/connector/sealed", { tool: "read_conversation", query: "conversation", video: args.video });
      return { ...(await c.openConversation(data.conversation, { transcript: args.include_transcript === true })), note: NOTE };
    },
  },
  {
    name: "search_text",
    title: "Search messages, replies and notes",
    description:
      "Searches recent messages, replies, to-dos, notes and AI summaries for some words, unlocking them on this computer. Use it to find what a client said about something.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Words to look for (not case sensitive)." },
        days: { type: "integer", minimum: 1, maximum: 365, description: "How many days back to search conversations (default 30). Open to-dos and notes are always searched." },
      },
      required: ["text"],
      additionalProperties: false,
    },
    async run(c, args) {
      const needle = String(args.text ?? "").trim().toLowerCase();
      if (!needle) throw new UserError("text is required");
      const data = await c.call("/api/connector/sealed", { tool: "search_text", query: "recent", days: args.days ?? 30, summaries: true });
      const hits = [];
      const has = (s) => typeof s === "string" && s.toLowerCase().includes(needle);
      for (const i of await Promise.all(data.items.map(c.openItem))) if (has(i.text)) hits.push({ in: i.kind, client: i.client, text: i.text, due: i.due, updated: i.updated });
      for (const v of await Promise.all(data.conversations.map((x) => c.openConversation(x)))) {
        const where = { client: v.client, video: v.title, video_id: v.id };
        if (has(v.message)) hits.push({ in: "video message", ...where, text: v.message, at: v.sent_at });
        for (const r of v.replies) if (has(r.text)) hits.push({ in: "reply", ...where, from: r.from, text: r.text, at: r.at });
        if (v.summary && has(JSON.stringify(v.summary))) hits.push({ in: "AI summary", ...where, summary: v.summary });
      }
      return { matches: hits.length, results: hits.slice(0, 100), note: NOTE };
    },
  },
];

// ---------- MCP over stdio ----------

export function makeServer(code, opts = {}) {
  let connector = null;
  let codeError = null;
  try {
    connector = makeConnector(code, opts);
  } catch (e) {
    codeError = e.message;
  }

  async function remote(method, params) {
    const res = await connector.call("/api/mcp", { jsonrpc: "2.0", id: 1, method, params });
    if (res?.error) throw new UserError(res.error.message);
    return res?.result;
  }

  async function tools() {
    const local = LOCAL_TOOLS.map(({ run: _r, ...t }) => ({ ...t, annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
    if (!connector) return local;
    const online = await remote("tools/list", {}).catch((e) => (log("tools/list:", e.message), null));
    return [...(online?.tools ?? []), ...local];
  }

  async function callTool(name, args) {
    if (!connector) return { content: [{ type: "text", text: codeError }], isError: true };
    const local = LOCAL_TOOLS.find((t) => t.name === name);
    try {
      if (!local) return await remote("tools/call", { name, arguments: args });
      return { content: [{ type: "text", text: JSON.stringify(await local.run(connector, args ?? {})) }] };
    } catch (e) {
      if (e instanceof UserError) return { content: [{ type: "text", text: e.message }], isError: true };
      log(name, e);
      return { content: [{ type: "text", text: "Something went wrong reading SureFrame. Try again in a moment." }], isError: true };
    }
  }

  return async function handle(msg) {
    const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
    switch (msg.method) {
      case "initialize": {
        const asked = msg.params?.protocolVersion;
        return reply({
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "sureframe-desktop", title: "SureFrame", version: VERSION },
          instructions:
            "SureFrame is a private video messaging tool businesses use with their clients. These tools read the person's own SureFrame team, read-only. " +
            "The activity tools (get_overview, list_clients and so on) give names, dates and counts; the read_ tools and search_text unlock to-dos, notes, messages, replies and summaries on this computer.",
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: await tools() });
      case "tools/call":
        return reply(await callTool(msg.params?.name, msg.params?.arguments));
      default:
        if (msg.id === undefined) return null;
        return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const handle = makeServer(process.env.SUREFRAME_CONNECTION_CODE);
  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
      return;
    }
    const out = await handle(msg).catch((e) => (log(e), msg.id === undefined ? null : { jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: "Internal error" } }));
    if (out) process.stdout.write(JSON.stringify(out) + "\n");
  });
  rl.on("close", () => process.exit(0));
}
