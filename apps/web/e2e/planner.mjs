// Encrypted to-dos and notes. A business keeps its own private list, and a
// list per client where each item is either private to the team or shared
// with that client. The client sees only what is shared and can tick off
// shared to-dos. Checks the server stores only ciphertext.
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const sql = (q) => execSync(`su postgres -c "psql -d ${process.env.PGDATABASE ?? "framecast"} -tAc \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const ok = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}`);
  if (!cond) process.exitCode = 1;
};

const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], viewport: { width: 1360, height: 900 } });
const pro = await ctx.newPage();
pro.on("console", (m) => m.type() === "error" && console.log("business console:", m.text()));
await pro.goto(BASE + "/library");
const loginEmail = `owner${Date.now()}@business.com`;
await agreed(loginEmail);
await pro.fill('input[name="email"]', loginEmail);
await pro.click("text=Continue");
await pro.waitForURL("**/library");
await pro.click("text=I've saved it");

// Their own private list
await pro.fill('textarea[aria-label="New to-do"]', "Order new stock");
await pro.click("form >> button:has-text('Add')");
await pro.waitForSelector('li:has-text("Order new stock")');
ok("own to-do added in library", true);

// A client and their space
await pro.goto(BASE + "/clients");
await pro.fill('input[aria-label="Client name"]', "Riley Client");
await pro.click("button:has-text('Add client')");
await pro.click("a:has-text('Riley Client')");
await pro.waitForURL("**/clients/**");
const clientId = pro.url().split("/clients/")[1];

await pro.fill('textarea[aria-label="New to-do"]', "Send your weekly check-in");
await pro.fill('input[aria-label="Due date"]', "2026-01-05T09:00");
await pro.check("text=Share with Riley");
await pro.click("form >> button:has-text('Add')");
await pro.waitForSelector('li:has-text("Send your weekly check-in")');

ok("after adding, the share box is unticked again", !(await pro.isChecked("text=Share with Riley")));
await pro.check("text=Share with Riley");
await pro.click("role=tab[name='Note']");
ok("switching between To-do and Note unticks the share box", !(await pro.isChecked("text=Share with Riley")));
ok("unticked says it's private", (await pro.textContent("[data-testid=share-choice]")).includes("Private: only your team will see this note") && (await pro.textContent("form >> button:has-text('Add')")) === "Add privately");
await pro.check("text=Share with Riley");
ok("ticked says the client will see it", (await pro.textContent("[data-testid=share-choice]")).includes("Riley Client will see this note") && (await pro.textContent("form >> button:has-text('Add')")) === "Add and share with Riley Client");
await pro.fill('textarea[aria-label="New note"]', "Remember to stretch before sessions");
await pro.click("form >> button:has-text('Add')");
await pro.waitForSelector('li:has-text("Remember to stretch before sessions")');

await pro.uncheck("text=Share with Riley");
await pro.fill('textarea[aria-label="New note"]', "Prefers morning calls");
await pro.click("form >> button:has-text('Add')");
await pro.waitForSelector('li:has-text("Prefers morning calls")');
ok("overdue due date shown in red", (await pro.getAttribute("text=/^Due .*Jan 5/", "class"))?.includes("text-danger-fg"));
await pro.screenshot({ path: `${shots}/client-space.png`, fullPage: true });

// The list updates before the save finishes, so wait for all three rows.
const itemsSql = (what) => sql(`select ${what} from "Item" where "workspaceId"=(select "workspaceId" from "Client" where id='${clientId}')`);
for (let i = 0; i < 50 && Number(itemsSql("count(*)")) < 3; i++) await new Promise((r) => setTimeout(r, 100));
const bodies = itemsSql("string_agg(body, '|')");
ok("server stores only ciphertext", !/stock|check-in|stretch|morning/i.test(bodies) && bodies.length > 100);

await pro.click("text=Copy personal link");
const personal = await pro.evaluate(() => navigator.clipboard.readText());

// The client on their phone
const phoneCtx = await browser.newContext({ ...devices["Pixel 7"] });
const phone = await phoneCtx.newPage();
phone.on("console", (m) => m.type() === "error" && console.log("client console:", m.text()));
await phone.goto(personal);
await phone.waitForURL("**/inbox**");
await phone.waitForSelector("text=Send your weekly check-in", { timeout: 15000 });
ok("client sees shared to-do", true);
ok("client sees shared note", await phone.isVisible("text=Remember to stretch before sessions"));
ok("client cannot see private note", !(await phone.isVisible("text=Prefers morning calls")));
ok("client cannot see business's own list", !(await phone.isVisible("text=Order new stock")));
ok("client has no add form", !(await phone.isVisible('textarea[aria-label="New to-do"]')));
await phone.click('input[aria-label^="Mark \\"Send your weekly check-in\\""]');
await phone.waitForSelector("text=Done (1)");
await phone.screenshot({ path: `${shots}/client-planner-phone.png`, fullPage: true });

// The client can't add, read private items or edit text through the API
const api = await phone.evaluate(async (clientId) => {
  const add = await fetch("/api/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "TASK", body: "x".repeat(40), clientId }) });
  const list = await (await fetch(`/api/items?clientId=${clientId}`)).json();
  const mine = await fetch("/api/items");
  return { add: add.status, count: list.items.length, mine: mine.status };
}, clientId);
ok("client cannot add items (403)", api.add === 403);
ok("client API returns only the 2 shared items", api.count === 2);
ok("client cannot read the business's own list", api.mine === 401);
const privateId = sql(`select id from "Item" where "clientId"='${clientId}' and shared=false`);
const peek = await phone.evaluate(async (id) => (await fetch(`/api/items/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done: true }) })).status, privateId);
ok("client cannot touch private items (404)", peek === 404);

// The business sees it ticked off, then shares the private note
await pro.reload();
await pro.waitForSelector("text=Done (1)");
ok("business sees the to-do ticked off", true);
await pro.click("li:has-text('Prefers morning calls') >> button:has-text('Private to your team')");
await pro.waitForSelector("li:has-text('Prefers morning calls') >> text=Shared with Riley");
await phone.reload();
await phone.waitForSelector("text=Prefers morning calls", { timeout: 15000 });
ok("note shared later is readable by client", true);

await browser.close();
