// When a plan drops below what a workspace uses (here a free plan we gave is
// taken back), clients and staff beyond the new limits are paused, the owner
// is emailed, and they come back on an upgrade or when seats free up.
// Needs the app running with AUTH_DEV_LOGIN=true and SUPPORT_EMAIL=owner@test.dev.
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
let failed = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`); if (!cond) failed++; };
const outbox = ".data/outbox";
const mailTo = (to) => { try { return readdirSync(outbox).map((f) => JSON.parse(readFileSync(`${outbox}/${f}`, "utf8"))).filter((m) => m.to === to); } catch { return []; } };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
async function signIn(email, next) {
  // Agreed to the current Terms and Privacy Policy, so signing in isn't stopped at /agree (e2e/agree.mjs).
  await agreed(email);
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/login?next=${next}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === next, { timeout: 60000 });
  return page;
}
const stamp = Date.now();
const ownerEmail = `pause${stamp}@example.com`;
const staffEmail = `pausestaff${stamp}@example.com`;
const boss = await signIn(ownerEmail, "/clients");
const staff = await signIn(staffEmail, "/library");
const ws = (await prisma.membership.findFirst({ where: { user: { email: ownerEmail }, role: "OWNER" } })).workspaceId;
const staffUser = await prisma.user.findUnique({ where: { email: staffEmail } });
await prisma.membership.create({ data: { userId: staffUser.id, workspaceId: ws, role: "MEMBER", seeAllClients: true } });
await prisma.user.update({ where: { id: staffUser.id }, data: { activeWorkspaceId: ws } });

const founder = await signIn("owner@test.dev", "/support/accounts");
async function setPlan(plan) {
  await founder.goto(BASE + "/support/accounts");
  await founder.fill('input[name="email"]', ownerEmail);
  await founder.selectOption("select", plan);
  await founder.fill('textarea[name="reason"]', "Test plan change");
  await founder.click("text=Save");
  await founder.waitForSelector(plan === "FREE" ? "text=back on the Free plan" : "text=free of charge");
}
await setPlan("STUDIO");
// Five clients, oldest first.
const names = ["Ann", "Ben", "Cat", "Dan", "Eve"];
const clients = [];
for (const [i, name] of names.entries()) {
  clients.push(await prisma.client.create({ data: { name, token: `pause-${stamp}-${i}-${"x".repeat(20)}`, workspaceId: ws, createdAt: new Date(Date.now() - (10 - i) * 60000) } }));
}
await staff.goto(BASE + "/library");
ok("staff use the team on Studio", new URL(staff.url()).pathname === "/library");

// The free Studio plan ends: Free covers 3 clients and 1 login.
await setPlan("FREE");
const after = await prisma.client.findMany({ where: { workspaceId: ws }, orderBy: { createdAt: "asc" } });
ok("longest-standing 3 clients keep access", after.slice(0, 3).every((c) => !c.pausedAt));
ok("newest 2 clients paused", after.slice(3).every((c) => c.pausedAt));
const staffM = await prisma.membership.findFirst({ where: { workspaceId: ws, userId: staffUser.id } });
const ownerM = await prisma.membership.findFirst({ where: { workspaceId: ws, role: "OWNER" } });
ok("staff login paused", !!staffM.pausedAt);
ok("owner never paused", !ownerM.pausedAt);
const mail = mailTo(ownerEmail).find((m) => m.subject.includes("paused"));
ok("owner emailed", !!mail);
ok("email says 2 clients and 1 login", !!mail && mail.text.includes("2 clients are paused") && mail.text.includes("1 staff login is paused"), mail?.text);
ok("email asks the owner to tell people", !!mail && mail.text.includes("let anyone affected know"));

await boss.goto(BASE + "/clients");
ok("clients page explains the pause", !!(await boss.waitForSelector("[data-testid=paused-clients-note]", { timeout: 15000 }).catch(() => null)));
await boss.waitForSelector("[data-testid=client-paused-badge]", { timeout: 15000 }).catch(() => null);
const badges = await boss.locator("[data-testid=client-paused-badge]").count();
ok("2 clients marked Paused", badges === 2, `${badges} badges; ${await boss.textContent("main")}`);
await boss.goto(BASE + "/settings/team");
ok("team page marks the staff member Paused", !!(await boss.waitForSelector("[data-testid=staff-paused-badge]", { timeout: 15000 }).catch(() => null)));

// Paused client's link.
const eveCtx = await browser.newContext();
const eve = await eveCtx.newPage();
await eve.goto(`${BASE}/c/${clients[4].token}`);
ok("paused client sees why", !!(await eve.waitForSelector("[data-testid=client-paused]", { timeout: 15000 }).catch(() => null)));
const annCtx = await browser.newContext();
const ann = await annCtx.newPage();
await ann.goto(`${BASE}/c/${clients[0].token}`);
ok("covered client still gets in", new URL(ann.url()).pathname === "/inbox" && !(await ann.isVisible("[data-testid=client-paused]")));

// Paused staff.
await staff.goto(BASE + "/library");
await staff.waitForURL("**/paused", { timeout: 15000 }).catch(() => null);
ok("paused staff land on the paused page", new URL(staff.url()).pathname === "/paused");
ok("paused page tells them to ask the owner", (await staff.textContent("[data-testid=paused-message]")).includes("Ask the owner"));
ok("paused staff refused by the API", (await staff.request.get(BASE + "/api/clients")).status() === 403);

// A paused client can't be sent anything.
const v = await prisma.video.create({ data: { id: `pv${stamp}`.slice(0, 12), title: "t", mimeType: "video/webm", storageKey: `videos/${ws}/x`, ownerId: ownerM.userId, workspaceId: ws, status: "UPLOADED" } });
const send = await boss.request.patch(`${BASE}/api/videos/${v.id}`, { data: { clientId: clients[4].id } });
ok("sending to a paused client refused", send.status() === 400, String(send.status()));

// Removing a covered client frees a seat: the longest-standing paused one comes back.
ok("owner removes a client", (await boss.request.delete(`${BASE}/api/clients/${clients[1].id}`)).status() === 200);
const dan = await prisma.client.findUnique({ where: { id: clients[3].id } });
const eve2 = await prisma.client.findUnique({ where: { id: clients[4].id } });
ok("Dan restored when a seat frees up", !dan.pausedAt && !!eve2.pausedAt);

// Upgrading restores everyone.
await setPlan("STUDIO");
ok("upgrade restores the last client", !(await prisma.client.findUnique({ where: { id: clients[4].id } })).pausedAt);
ok("upgrade restores the staff login", !(await prisma.membership.findUnique({ where: { id: staffM.id } })).pausedAt);
await staff.goto(BASE + "/library");
ok("restored staff use the team again", new URL(staff.url()).pathname === "/library");

await browser.close();
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
