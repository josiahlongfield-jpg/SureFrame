// The SureFrame connectors for Claude (src/lib/connector, apps/connector): OAuth sign-in with PKCE for the online
// connector, its read-only activity tools over MCP, Settings > Connections, disconnecting, staff scoping, and the
// desktop connector unlocking encrypted content with a connection code made in the browser.
// Run against a server with RATE_LIMITS=off (group A env).
import { chromium } from "@playwright/test";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";
import { makeServer } from "../../connector/src/server/index.js";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const stamp = Date.now();
const subtle = webcrypto.subtle;
const ALG = { name: "AES-GCM", length: 256 };

// ---------- crypto, the same as src/lib/e2e/crypto.ts ----------
const b64 = (b) => Buffer.from(b).toString("base64url");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64url"));
const importKey = (t) => subtle.importKey("raw", unb64(t.replace(/\s+/g, "")), ALG, true, ["encrypt", "decrypt"]);
const newKey = () => subtle.generateKey(ALG, true, ["encrypt", "decrypt"]);
async function seal(bytes, key) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  return b64(Buffer.concat([iv, ct]));
}
const encryptText = (t, k) => seal(new TextEncoder().encode(t), k);
const wrapKey = async (k, w) => seal(new Uint8Array(await subtle.exportKey("raw", k)), w);
async function unwrapKey(wrapped, w) {
  const s = unb64(wrapped);
  const raw = await subtle.decrypt({ name: "AES-GCM", iv: s.subarray(0, 12) }, w, s.subarray(12));
  return subtle.importKey("raw", raw, ALG, true, ["encrypt", "decrypt"]);
}
const fingerprint = async (k) => b64(new Uint8Array(await subtle.digest("SHA-256", new Uint8Array(await subtle.exportKey("raw", k))))).slice(0, 22);
const sha256hex = (t) => createHash("sha256").update(t).digest("hex");

async function signIn(page, email, next) {
  await agreed(email);
  await page.goto(`${BASE}/login?next=${next}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === next);
}

// ---------- a business with encrypted content ----------
const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
const owner = await ctx.newPage();
await signIn(owner, `cn-owner${stamp}@example.com`, "/record");
const recoveryKey = await owner.getAttribute("[data-recovery-key]", "data-recovery-key");
await owner.click("text=I've saved it");
const me = await prisma.user.findUnique({ where: { email: `cn-owner${stamp}@example.com` }, include: { memberships: true } });
const workspaceId = me.memberships[0].workspaceId;
await owner.goto(BASE + "/clients");
for (const name of ["Avery", "Blake"]) {
  await owner.fill('input[aria-label="Client name"]', name);
  await owner.click("button:has-text('Add client')");
  await owner.waitForSelector(`a:has-text('${name}')`);
}
const avery = await prisma.client.findFirst({ where: { workspaceId, name: "Avery" } });
const blake = await prisma.client.findFirst({ where: { workspaceId, name: "Blake" } });
const teamKey = await importKey(recoveryKey);
const averyKey = await unwrapKey(avery.teamKeyWrap, teamKey);

const videoKey = await newKey();
const videoId = `cn${stamp}`.slice(0, 16);
await prisma.video.create({
  data: {
    id: videoId, title: "Plan review", status: "READY", mimeType: "video/webm", storageKey: `test/${videoId}`, ownerId: me.id, workspaceId, clientId: avery.id,
    encrypted: true, teamKeyWrap: await wrapKey(videoKey, teamKey), message: await encryptText("Here is the plan we talked about", videoKey),
    viewCount: 1, sentAt: new Date(Date.now() - 2 * 86_400_000), createdAt: new Date(Date.now() - 2 * 86_400_000),
  },
});
await prisma.reply.create({ data: { videoId, kind: "TEXT", body: await encryptText("Can we move the meeting to Friday?", videoKey), encrypted: true, authorName: "Avery", byClient: true, createdAt: new Date(Date.now() - 86_400_000) } });
await prisma.videoInsight.create({
  data: { videoId, transcript: await encryptText(JSON.stringify({ language: "en", segments: [{ start: 0, end: 2, text: "Hello Avery." }] }), videoKey), summary: await encryptText(JSON.stringify({ overview: "Walkthrough of the spring plan", keyPoints: ["Budget agreed"], actionItems: ["Book Friday"] }), videoKey) },
});
const blakeVideo = `cb${stamp}`.slice(0, 16);
await prisma.video.create({ data: { id: blakeVideo, title: "Blake intro", status: "READY", mimeType: "video/webm", storageKey: `test/${blakeVideo}`, ownerId: me.id, workspaceId, clientId: blake.id, encrypted: true, teamKeyWrap: await wrapKey(await newKey(), teamKey), sentAt: new Date() } });
await prisma.item.createMany({
  data: [
    { workspaceId, clientId: null, kind: "TASK", body: await encryptText("Send the invoices", teamKey), dueAt: new Date(Date.now() - 86_400_000), authorName: "Owner" },
    { workspaceId, clientId: avery.id, kind: "NOTE", body: await encryptText("Avery prefers mornings", teamKey), authorName: "Owner" },
    { workspaceId, clientId: avery.id, kind: "TASK", shared: true, body: await encryptText("Avery to sign the agreement", averyKey), dueAt: new Date(Date.now() + 86_400_000), authorName: "Owner" },
  ],
});

// ---------- discovery ----------
const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
ok("protected resource metadata names the MCP address", prm.resource === `${BASE}/mcp` && prm.authorization_servers?.[0] === BASE, JSON.stringify(prm));
const asm = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
ok("authorization server metadata", asm.authorization_endpoint === `${BASE}/oauth/authorize` && asm.code_challenge_methods_supported?.includes("S256") && !!asm.registration_endpoint, JSON.stringify(asm));
const mcp = (token, body) => fetch(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const anon = await mcp(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
ok("MCP without a token asks to sign in", anon.status === 401 && (anon.headers.get("www-authenticate") ?? "").includes(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`), `${anon.status} ${anon.headers.get("www-authenticate")}`);
ok("MCP GET is not allowed", (await fetch(`${BASE}/mcp`)).status === 405);

// ---------- registration ----------
const reg = (uris) => fetch(asm.registration_endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude Code", redirect_uris: uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] }) });
const bad = await reg(["https://evil.example/cb"]);
ok("registration refuses other redirect addresses", bad.status === 400);
const redirect = "http://127.0.0.1:43210/callback";
const client = await (await reg([redirect])).json();
ok("registration gives a public client", client.client_id?.startsWith("sfc_") && client.token_endpoint_auth_method === "none", JSON.stringify(client));

// ---------- sign-in with PKCE ----------
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = "st" + stamp;
const authorizeUrl = `${asm.authorization_endpoint}?${new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: "http://127.0.0.1:51999/callback", state, code_challenge: challenge, code_challenge_method: "S256", scope: "read", resource: `${BASE}/mcp` })}`;
let landed = null;
await owner.route("http://127.0.0.1:51999/**", (r) => {
  landed = r.request().url();
  return r.fulfill({ status: 200, body: "ok" });
});
await owner.goto(authorizeUrl);
ok("consent page names the assistant", (await owner.textContent("[data-testid=authorize-heading]"))?.includes("Claude Code"));
ok("consent page shows where it goes back to (loopback, any port)", (await owner.textContent("[data-testid=authorize-host]"))?.includes("127.0.0.1:51999"));
await owner.screenshot({ path: `${shots}/connector-consent.png`, fullPage: true });
ok("consent page fits the app's sign-in look: a card with the logo and a way to Settings > Connections (D9)", await owner.isVisible("main a[href='/settings/connections']"));
await owner.click("button:has-text('Allow')");
await owner.waitForURL("http://127.0.0.1:51999/**");
const back = new URL(landed);
ok("Allow returns a code with the state and issuer", !!back.searchParams.get("code") && back.searchParams.get("state") === state && back.searchParams.get("iss") === BASE, landed);
const token = (form) => fetch(asm.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
const code = back.searchParams.get("code");
const wrong = await token({ grant_type: "authorization_code", code, code_verifier: randomBytes(32).toString("base64url"), client_id: client.client_id, redirect_uri: "http://127.0.0.1:51999/callback" });
ok("a wrong PKCE verifier is refused", wrong.status === 400 && (await wrong.json()).error === "invalid_grant");
const t1 = await (await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id, redirect_uri: "http://127.0.0.1:51999/callback" })).json();
ok("the code swaps for tokens", t1.access_token?.startsWith("sfa_") && t1.refresh_token?.startsWith("sfr_") && t1.token_type === "Bearer", JSON.stringify(t1));
const again = await token({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.client_id });
ok("a code works once", again.status === 400);
const stored = await prisma.connectorGrant.findFirst({ where: { userId: me.id, kind: "online" } });
ok("only token fingerprints are stored", stored && stored.accessHash === sha256hex(t1.access_token) && !JSON.stringify(stored).includes(t1.access_token));

// A broken request: says so, with a way back (O97, D9).
await owner.goto(`${BASE}/oauth/authorize?response_type=code&client_id=nobody`);
ok("a broken Allow page says so and offers a way back", (await owner.isVisible("[data-testid=authorize-invalid]")) && (await owner.getAttribute("[data-testid=authorize-back]", "href")) === "/settings/connections");

// Cancelling goes back with access_denied.
await owner.goto(authorizeUrl.replace(`state=${state}`, "state=cancel1"));
await owner.click("button:has-text('Cancel')");
await owner.waitForURL("http://127.0.0.1:51999/**");
ok("Cancel returns access_denied", new URL(landed).searchParams.get("error") === "access_denied" && new URL(landed).searchParams.get("state") === "cancel1", landed);

// ---------- MCP tools ----------
let id = 1;
const rpc = async (tok, method, params) => {
  const res = await mcp(tok, { jsonrpc: "2.0", id: ++id, method, params });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const tool = async (tok, name, args = {}) => {
  const r = await rpc(tok, "tools/call", { name, arguments: args });
  const text = r.body?.result?.content?.[0]?.text ?? "";
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { ...r, text, data, isError: !!r.body?.result?.isError };
};
const init = await rpc(t1.access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
ok("initialize", init.body?.result?.protocolVersion === "2025-06-18" && init.body?.result?.capabilities?.tools, JSON.stringify(init.body));
const note = await mcp(t1.access_token, { jsonrpc: "2.0", method: "notifications/initialized" });
ok("notifications get 202", note.status === 202);
const list = await rpc(t1.access_token, "tools/list", {});
const names = list.body?.result?.tools?.map((t) => t.name) ?? [];
ok("owner gets every activity tool, all read-only", ["get_overview", "list_clients", "get_client_activity", "list_replies_waiting", "list_todos", "list_videos", "get_team_activity"].every((n) => names.includes(n)) && list.body.result.tools.every((t) => t.annotations?.readOnlyHint), names.join());
const overview = await tool(t1.access_token, "get_overview", { days: 7 });
ok("overview counts", overview.data?.clients === 2 && overview.data?.videos_sent === 2 && overview.data?.videos_opened === 1 && overview.data?.clients_waiting_for_answer === 1 && overview.data?.todos?.overdue === 1, overview.text);
const waiting = await tool(t1.access_token, "list_replies_waiting");
ok("replies waiting names the client and video", waiting.data?.count === 1 && waiting.data.waiting[0].client === "Avery" && waiting.data.waiting[0].video === "Plan review", waiting.text);
const activity = await tool(t1.access_token, "get_client_activity", { client: "aver" });
ok("client activity by part of a name", activity.data?.client?.name === "Avery" && activity.data.videos[0].replies[0].from === "client" && activity.data.todos.length === 1 && activity.data.notes === 1, activity.text);
const all = [overview, waiting, activity].map((x) => x.text).join(" ");
ok("no encrypted text reaches the online connector", !/Friday|mornings|invoices|agreement|spring plan/.test(all));
const todos = await tool(t1.access_token, "list_todos", { range: "overdue" });
ok("to-do dates only", todos.data?.count === 1 && todos.data.todos[0].client === "Business list" && todos.data.todos[0].overdue, todos.text);
const quiet = await tool(t1.access_token, "list_clients", { filter: "waiting" });
ok("clients filter", quiet.data?.count === 1 && quiet.data.clients[0].name === "Avery", quiet.text);
const team = await tool(t1.access_token, "get_team_activity", { days: 30 });
ok("team activity for the owner", team.data?.whole_business?.clients_waiting_for_answer === 1, team.text);
const badArg = await tool(t1.access_token, "get_client_activity", { client: "Nobody" });
ok("a client that isn't there is a tool error", badArg.isError && badArg.text.includes("No client"), badArg.text);
const unknown = await rpc(t1.access_token, "tools/call", { name: "send_video", arguments: {} });
ok("unknown tools are refused", unknown.body?.error?.code === -32602);
ok("uses are logged without results", (await prisma.connectorUse.count({ where: { grantId: stored.id } })) >= 6);

// ---------- refresh ----------
const t2 = await (await token({ grant_type: "refresh_token", refresh_token: t1.refresh_token, client_id: client.client_id })).json();
ok("refresh gives new tokens", t2.access_token && t2.access_token !== t1.access_token && t2.refresh_token !== t1.refresh_token, JSON.stringify(t2));
const reused = await token({ grant_type: "refresh_token", refresh_token: t1.refresh_token, client_id: client.client_id });
ok("an old refresh token is refused", reused.status === 400 && (await reused.json()).error === "invalid_grant");
const oldAccess = await mcp(t1.access_token, { jsonrpc: "2.0", id: 99, method: "tools/list" });
ok("the old access token stops working", oldAccess.status === 401 && (oldAccess.headers.get("www-authenticate") ?? "").includes("invalid_token"));
ok("the new access token works", (await rpc(t2.access_token, "tools/list", {})).status === 200);

// ---------- desktop connector ----------
await owner.goto(BASE + "/settings/connections");
await owner.click("[data-testid=make-connection-code]");
const connectionCode = await owner.inputValue("[data-testid=connection-code-text]");
ok("connection code made in the browser", connectionCode.startsWith("sfc1_"));
ok("Copy code is the main button by the code (S76)", await owner.isVisible("[data-testid=copy-connection-code]"));
const lifetime = (await owner.textContent("[data-testid=code-lifetime]")) ?? "";
ok("says a lost code means making another, and only Disconnect ends one (O95, B12)", lifetime.includes("Lost a code? Make another") && lifetime.includes("Resetting your team's key doesn't end a code; only Disconnect does"), lifetime);
await owner.reload();
ok("an unused code shows as waiting for Claude Desktop (S73)", (await owner.locator("#yours [data-testid=connection-status]", { hasText: "waiting for Claude Desktop" }).count()) === 1);
const desktopGrant = await prisma.connectorGrant.findFirst({ where: { userId: me.id, kind: "desktop" } });
ok("the server never saw the key", !!desktopGrant && !JSON.stringify(desktopGrant).includes(recoveryKey.replace(/\s+/g, "")));
const desk = makeServer(connectionCode);
let did = 0;
const dcall = async (name, args = {}) => {
  const r = await desk({ jsonrpc: "2.0", id: ++did, method: "tools/call", params: { name, arguments: args } });
  const text = r.result.content[0].text;
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { text, data, isError: !!r.result.isError };
};
const dtools = (await desk({ jsonrpc: "2.0", id: 0, method: "tools/list" })).result.tools.map((t) => t.name);
ok("desktop lists activity and unlocking tools", dtools.includes("get_overview") && dtools.includes("read_client") && dtools.includes("search_text"), dtools.join());
const rc = await dcall("read_client", { client: "Avery" });
const conv = rc.data?.conversations?.[0];
ok("desktop unlocks replies and messages", conv?.message === "Here is the plan we talked about" && conv?.replies?.[0]?.text === "Can we move the meeting to Friday?", rc.text);
ok("desktop unlocks private notes and shared to-dos", rc.data?.notes?.[0]?.text === "Avery prefers mornings" && rc.data?.todos?.[0]?.text === "Avery to sign the agreement", rc.text);
ok("desktop unlocks the AI summary", conv?.summary?.overview === "Walkthrough of the spring plan", JSON.stringify(conv?.summary));
const conversation = await dcall("read_conversation", { video: videoId, include_transcript: true });
ok("desktop transcript", conversation.data?.transcript === "Hello Avery.", conversation.text);
const found = await dcall("search_text", { text: "INVOICES" });
ok("desktop search", found.data?.matches === 1 && found.data.results[0].text === "Send the invoices", found.text);
const overdue = await dcall("read_todos", { range: "overdue" });
ok("desktop to-dos with text", overdue.data?.todos?.[0]?.text === "Send the invoices", overdue.text);
const passthrough = await dcall("get_overview", {});
ok("desktop passes activity tools through", passthrough.data?.clients === 2, passthrough.text);
const onlineOnSealed = await fetch(`${BASE}/api/connector/sealed`, { method: "POST", headers: { Authorization: `Bearer ${t2.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: "keys" }) });
ok("online connections can't fetch encrypted content", onlineOnSealed.status === 401 || onlineOnSealed.status === 403, String(onlineOnSealed.status));

// Over stdio, as Claude Desktop runs it.
const proc = spawn(process.execPath, [new URL("../../connector/src/server/index.js", import.meta.url).pathname], { env: { ...process.env, SUREFRAME_CONNECTION_CODE: connectionCode }, stdio: ["pipe", "pipe", "inherit"] });
const lines = [];
proc.stdout.on("data", (d) => lines.push(...d.toString().split("\n").filter(Boolean)));
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) + "\n");
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_notes", arguments: {} } }) + "\n");
for (let i = 0; i < 100 && lines.length < 2; i++) await new Promise((r) => setTimeout(r, 100));
proc.kill();
const out = lines.map((l) => JSON.parse(l));
ok("stdio server answers", out[0]?.result?.serverInfo?.name === "sureframe-desktop" && out[1]?.result?.content?.[0]?.text.includes("Avery prefers mornings"), lines.join("\n"));

const badCode = makeServer(connectionCode.slice(0, 20));
const badRes = await badCode({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_notes", arguments: {} } });
ok("a broken code explains itself", badRes.result.isError && /connection code/i.test(badRes.result.content[0].text), JSON.stringify(badRes));

// After a key reset, the code's key follows the chain to the current one.
const nextKey = await newKey();
await prisma.keyRotation.create({ data: { workspaceId, fromFingerprint: await fingerprint(teamKey), wrap: await wrapKey(nextKey, teamKey) } });
await prisma.workspace.update({ where: { id: workspaceId }, data: { keyFingerprint: await fingerprint(nextKey) } });
const note2 = await prisma.item.findFirst({ where: { workspaceId, kind: "NOTE" } });
await prisma.item.update({ where: { id: note2.id }, data: { body: await encryptText("Avery prefers mornings, still", nextKey) } });
const rotated = await makeServer(connectionCode)({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_notes", arguments: { client: "Avery" } } });
ok("desktop follows key resets", rotated.result.content[0].text.includes("Avery prefers mornings, still"), rotated.result.content[0].text);
const stranger = await newKey();
const strangerCode = "sfc1_" + Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(connectionCode.slice(5), "base64url").toString()), k: b64(new Uint8Array(await subtle.exportKey("raw", stranger))) })).toString("base64url");
const strangerRes = await makeServer(strangerCode)({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_notes", arguments: {} } });
ok("a key that can't reach the current one is refused", strangerRes.result.isError && /keys were reset/.test(strangerRes.result.content[0].text), strangerRes.result.content[0].text);
await prisma.workspace.update({ where: { id: workspaceId }, data: { keyFingerprint: await fingerprint(teamKey) } });
await prisma.keyRotation.deleteMany({ where: { workspaceId } });

// ---------- staff see only their clients ----------
const staffEmail = `cn-staff${stamp}@example.com`;
const staff = await agreed(staffEmail);
await prisma.membership.create({ data: { userId: staff.id, workspaceId, role: "MEMBER", seeAllClients: false } });
await prisma.client.update({ where: { id: blake.id }, data: { assignedToId: staff.id } });
const staffToken = `sfd_${randomBytes(32).toString("base64url")}`;
await prisma.connectorGrant.create({ data: { kind: "desktop", name: "Claude desktop connector", accessHash: sha256hex(staffToken), userId: staff.id, workspaceId } });
const staffList = await tool(staffToken, "list_clients");
ok("staff see only their own clients", staffList.data?.count === 1 && staffList.data.clients[0].name === "Blake", staffList.text);
const staffTools = (await rpc(staffToken, "tools/list", {})).body?.result?.tools?.map((t) => t.name) ?? [];
ok("staff don't get team activity", !staffTools.includes("get_team_activity") && staffTools.includes("get_overview"));
ok("staff can't read another's client", (await tool(staffToken, "get_client_activity", { client: avery.id })).isError);
const staffSealed = await fetch(`${BASE}/api/connector/sealed`, { method: "POST", headers: { Authorization: `Bearer ${staffToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: "client", client: avery.id }) });
ok("staff can't fetch another client's encrypted content", staffSealed.status === 400, String(staffSealed.status));
const staffItems = await (await fetch(`${BASE}/api/connector/sealed`, { method: "POST", headers: { Authorization: `Bearer ${staffToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: "items" }) })).json();
ok("staff items leave out other clients'", staffItems.items?.every((i) => i.client_id !== avery.id), JSON.stringify(staffItems).slice(0, 300));

// ---------- Settings > Connections ----------
await owner.goto(BASE + "/settings/connections");
await owner.setViewportSize({ width: 320, height: 800 });
ok("connections page fits a small phone", await owner.evaluate(() => document.documentElement.scrollWidth <= 320));
await owner.screenshot({ path: `${shots}/connector-settings.png`, fullPage: true });
await owner.setViewportSize({ width: 1280, height: 900 });
ok("connections page shows the address to paste", (await owner.textContent("[data-testid=connector-url]")) === `${BASE}/mcp`);
await owner.click("[data-testid=copy-connector-url]");
ok("Copy puts the address on the clipboard", (await owner.evaluate(() => navigator.clipboard.readText())) === `${BASE}/mcp`);
ok("your connections list both", (await owner.locator("#yours [data-testid=connection-row]").count()) === 2);
ok("recent uses are shown", (await owner.locator("#yours [data-testid=connection-uses]").first().textContent())?.includes("Recently read"));
ok("owner sees staff connections", (await owner.locator("[data-testid=staff-connections] [data-testid=connection-row]").count()) === 1);
await owner.locator("[data-testid=staff-connections] [data-testid=disconnect]").click();
// Disconnect asks first, and says the staff member is told (S75).
const confirmBox = (await owner.textContent("[data-testid=staff-connections] [data-testid=disconnect-confirm-box]")) ?? "";
ok("disconnect asks first and says they're emailed", confirmBox.includes("It stops reading SureFrame straight away") && confirmBox.includes("We email"), confirmBox);
ok("nothing disconnected while asking", (await rpc(staffToken, "tools/list", {})).status === 200);
await owner.click("[data-testid=staff-connections] [data-testid=disconnect-confirm]");
await owner.waitForSelector("[data-testid=staff-connections]", { state: "detached" });
ok("owner disconnects a staff connection", (await mcp(staffToken, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status === 401);
ok("the page says it's done and that they were emailed", ((await owner.textContent("[data-testid=disconnected-note]")) ?? "").includes("email"));
const staffMail = existsSync(".data/outbox") ? readdirSync(".data/outbox").map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8"))).filter((m) => m.to === staffEmail) : [];
ok("the staff member is emailed that their connection was disconnected", staffMail.some((m) => /disconnect/i.test(m.subject + m.text)), staffMail.map((m) => m.subject).join(" | "));
// Disconnect everything of the owner's.
while ((await owner.locator("#yours [data-testid=disconnect]").count()) > 0) {
  const before = await owner.locator("#yours [data-testid=disconnect]").count();
  await owner.locator("#yours [data-testid=disconnect]").first().click();
  await owner.click("#yours [data-testid=disconnect-confirm]");
  await owner.waitForFunction((n) => document.querySelectorAll("#yours [data-testid=disconnect]").length < n, before);
}
ok("disconnected online connection stops", (await mcp(t2.access_token, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status === 401);
const afterRevoke = await desk({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_notes", arguments: {} } });
ok("disconnected desktop connection says so", afterRevoke.result.isError && /disconnected|connection code/i.test(afterRevoke.result.content[0].text), afterRevoke.result.content[0].text);
ok("refresh after disconnect is refused", (await token({ grant_type: "refresh_token", refresh_token: t2.refresh_token })).status === 400);

// A replaced refresh token used again (after the retry grace) disconnects the connection.
{
  await owner.goto(authorizeUrl.replace(`state=${state}`, "state=reuse1"));
  await owner.click("button:has-text('Allow')");
  await owner.waitForURL("http://127.0.0.1:51999/**");
  const c = new URL(landed).searchParams.get("code");
  const r1 = await (await token({ grant_type: "authorization_code", code: c, code_verifier: verifier, client_id: client.client_id })).json();
  const r2 = await (await token({ grant_type: "refresh_token", refresh_token: r1.refresh_token })).json();
  ok("refresh for the reuse check", !!r2.access_token);
  await prisma.connectorGrant.updateMany({ where: { refreshHash: sha256hex(r2.refresh_token) }, data: { refreshedAt: new Date(Date.now() - 5 * 60_000) } });
  await token({ grant_type: "refresh_token", refresh_token: r1.refresh_token });
  ok("reusing a replaced refresh token disconnects", (await mcp(r2.access_token, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status === 401);
}
ok("registration refuses impossible ports", (await reg(["http://localhost:99999/cb"])).status === 400);
const nullBody = await fetch(asm.token_endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: "null" });
ok("a null token request is a clean error", nullBody.status === 400, String(nullBody.status));

// The help page and the desktop download are there.
ok("help page", (await fetch(`${BASE}/help/claude`)).status === 200);
const dl = await fetch(`${BASE}/connector/sureframe.mcpb`);
ok("desktop connector download", dl.status === 200 && (await dl.arrayBuffer()).byteLength > 1000);

await browser.close();
await prisma.$disconnect();
console.log("DONE");
