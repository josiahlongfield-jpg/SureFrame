// Team plans: staff invites with the team key handed over in the link's
// #fragment, roles, client assignment, staff limits and the Solo->Studio hint.
// Run against a server using the fake Stripe (same env as billing.mjs).
import { chromium } from "@playwright/test";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { start, state, createSubscription } from "./fake-stripe.mjs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const server = await start();
const sig = new Stripe("sk_test_fake");

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const owner = await (await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })).newPage();
const stamp = Date.now();
await owner.goto(BASE + "/login?next=/settings/team");
await agreed(`owner${stamp}@example.com`);
await owner.fill('input[name="email"]', `owner${stamp}@example.com`);
await owner.click("text=Continue");
await owner.waitForURL((u) => u.pathname === "/settings/team");

async function webhook(page, type, sub) {
  const payload = JSON.stringify({ id: `evt_${Date.now()}`, object: "event", type, data: { object: sub } });
  return page.request.post(BASE + "/api/webhooks/stripe", { headers: { "stripe-signature": sig.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" }), "content-type": "application/json" }, data: payload });
}

// Free and Solo have one login.
// The page streams in after the URL changes (app/loading.tsx), so wait for the text.
ok("Free plan points to Studio for staff", !!(await owner.waitForSelector("text=Studio includes 3 staff logins", { timeout: 15000 }).catch(() => null)));
const freeInvite = await owner.request.post(BASE + "/api/team/invites", { data: { teamKeyWrap: "x".repeat(44) } });
ok("Free plan can't invite staff", freeInvite.status() === 402);

// Upgrade to Studio.
await owner.request.post(BASE + "/api/billing/checkout", { data: { plan: "STUDIO" } });
const session = state.sessions.at(-1).params;
const workspaceId = session.subscription_data.metadata.workspaceId;
const sub = createSubscription(session.customer, workspaceId, "sureframe_studio_monthly");
await webhook(owner, "customer.subscription.created", sub);

// The owner's device creates the team key; a client to assign later.
await owner.goto(BASE + "/clients");
await owner.waitForSelector("text=Add a client");
await owner.fill('input[aria-label="Client name"]', "Avery");
await owner.click("button:has-text('Add client')");
await owner.waitForSelector("text=Avery");
const ownerKey = await owner.evaluate((id) => localStorage.getItem(`framecast.key.team:${id}`), workspaceId);

await owner.goto(BASE + "/settings/team");
await owner.waitForSelector("text=Staff logins");
ok("Studio shows 3 staff logins", /1\s*of 3 used/.test(await owner.textContent("main")), await owner.textContent("main"));
await owner.fill('input[aria-label="Staff email"]', `staff${stamp}@example.com`);
await owner.click("text=Create invite link");
const link = await (await owner.waitForSelector("[data-testid=invite-link]")).textContent();
ok("invite link carries a key in the fragment", /\/join\/[\w-]+#k=[\w-]+$/.test(link), link);
const invite = await prisma.invite.findFirst({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
ok("server stores only a hash of the token", !link.includes(invite.tokenHash) && invite.tokenHash.length === 64);
ok("server never sees the one-off key", !JSON.stringify(invite).includes(link.split("#k=")[1]));
await owner.screenshot({ path: `${process.argv[2] ?? "/tmp"}/team-invite.png`, fullPage: true });

// A new person opens the link, signs in, and joins.
const staffCtx = await browser.newContext();
const staff = await staffCtx.newPage();
await staff.goto(link);
await staff.click("text=Sign in to join");
await agreed(`staff${stamp}@example.com`);
await staff.fill('input[name="email"]', `staff${stamp}@example.com`);
await staff.click("text=Continue");
await staff.waitForURL((u) => u.pathname.startsWith("/join/"));
ok("after sign-in the fragment is gone but the key was kept", !staff.url().includes("#k="));
await staff.click("text=Join the team");
await staff.waitForURL((u) => u.pathname === "/library");
const staffUser = await prisma.user.findUnique({ where: { email: `staff${stamp}@example.com` }, include: { memberships: true } });
ok("staff joined as a member", staffUser.memberships.length === 1 && staffUser.memberships[0].workspaceId === workspaceId && staffUser.memberships[0].role === "MEMBER");
ok("no personal workspace made for staff", staffUser.memberships.length === 1);
const staffKey = await staff.evaluate((id) => localStorage.getItem(`framecast.key.team:${id}`), workspaceId);
ok("staff device holds the same team key", !!staffKey && staffKey === ownerKey);
ok("invite stash cleared", (await staff.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("framecast.invite:")).length)) === 0);
// Members see only their own clients and videos until the owner assigns or allows more.
ok("library shows the member's own view", !!(await staff.waitForSelector("h1:has-text('Your videos')", { timeout: 10000 }).catch(() => null)));
await staff.goto(BASE + "/clients");
await staff.waitForSelector("text=No clients are assigned to you yet");
ok("staff opens clients without a recovery key", !(await staff.isVisible("text=Unlock your videos")));
ok("staff don't see unassigned clients", !(await staff.isVisible("text=Avery")));
ok("members can't remove clients", !(await staff.isVisible("button:has-text('Remove')")));

// Roles.
const avery = await prisma.client.findFirst({ where: { workspaceId, name: "Avery" } });
ok("member can't delete a client", (await staff.request.delete(`${BASE}/api/clients/${avery.id}`)).status() === 403);
ok("member can't change the plan", (await staff.request.post(BASE + "/api/billing/checkout", { data: { plan: "AGENCY" } })).status() === 403);
ok("member can't invite", (await staff.request.post(BASE + "/api/team/invites", { data: { teamKeyWrap: "x".repeat(44) } })).status() === 403);
ok("member can't assign clients", (await staff.request.patch(`${BASE}/api/clients/${avery.id}`, { data: { assignedToId: staffUser.id } })).status() === 403);
await staff.goto(BASE + "/settings/billing");
ok("member sees billing is owner-only", !!(await staff.waitForSelector("text=Only the workspace owner", { timeout: 15000 }).catch(() => null)));

// A used link can't be reused by someone else.
const other = await (await browser.newContext()).newPage();
await other.goto(BASE + `/login?next=/library`);
await agreed(`other${stamp}@example.com`);
await other.fill('input[name="email"]', `other${stamp}@example.com`);
await other.click("text=Continue");
await other.waitForURL((u) => u.pathname === "/library");
const token = link.split("/join/")[1].split("#")[0];
ok("used invite refused for someone else", [403, 410].includes((await other.request.post(BASE + "/api/team/join", { data: { token } })).status()));
ok("same person can reopen it on another device", (await staff.request.post(BASE + "/api/team/join", { data: { token } })).ok());

// Assign Avery to the staff member; "My clients" shows them.
await owner.goto(BASE + "/clients");
await owner.selectOption('select[aria-label="Who looks after Avery"]', staffUser.id);
// The change saves in the background: give it a few seconds rather than a fixed pause.
let assigned = false;
for (let i = 0; i < 20 && !assigned; i++) {
  await owner.waitForTimeout(250);
  assigned = (await prisma.client.findUnique({ where: { id: avery.id } })).assignedToId === staffUser.id;
}
ok("owner assigned the client", assigned);
await staff.goto(BASE + "/clients");
await staff.waitForSelector("text=Avery");
ok("staff sees the client once it's assigned to them", await staff.isVisible("a:has-text('Avery')") && !(await staff.isVisible("text=/All clients \\(/")));

// Staff limit: owner + staff + one invite = 3 on Studio.
const mk = () => owner.request.post(BASE + "/api/team/invites", { data: { teamKeyWrap: "x".repeat(44) } });
const third = await mk();
ok("third login can be invited", third.status() === 201);
ok("fourth is refused at Studio's limit", (await mk()).status() === 402);
const { invite: pending } = await third.json();
await owner.request.delete(`${BASE}/api/team/invites/${pending.id}`);
ok("cancelling an invite frees the login", (await mk()).status() === 201);

// Extra staff are billed on the subscription.
const buy = await owner.request.post(BASE + "/api/billing/staff", { data: { extraStaff: 1 } });
ok("owner adds an extra staff login", buy.ok());
const live = state.subs.find((s) => s.id === sub.id);
const staffItem = live.items.data.find((i) => i.price.lookup_key === "sureframe_staff_seat_monthly");
ok("extra staff billed at $8/month", staffItem?.quantity === 1 && staffItem.price.unit_amount === 800);
await webhook(owner, "customer.subscription.updated", live);
ok("webhook keeps extra staff in sync", (await prisma.workspace.findUnique({ where: { id: workspaceId } })).extraStaffSeats === 1);
ok("members can't buy staff logins", (await staff.request.post(BASE + "/api/billing/staff", { data: { extraStaff: 5 } })).status() === 403);

// Can't drop to Solo while staff are on the team.
const down = await owner.request.post(BASE + "/api/billing/checkout", { data: { plan: "SOLO" } });
ok("downgrade to Solo blocked while staff remain", down.status() === 400);

// An owner can't delete their account and strand their staff.
await owner.goto(BASE + "/settings/account");
await owner.fill('input[name="confirm"]', `owner${stamp}@example.com`);
await owner.click("text=Delete my account");
await owner.waitForURL((u) => u.searchParams.get("error") === "team");
ok("owner with staff can't delete their account", !!(await prisma.user.findUnique({ where: { email: `owner${stamp}@example.com` } })));

// Removing staff puts their clients back in the shared list.
for (const i of await prisma.invite.findMany({ where: { workspaceId, acceptedAt: null, revokedAt: null } })) await owner.request.delete(`${BASE}/api/team/invites/${i.id}`);
await owner.goto(BASE + "/settings/team");
owner.once("dialog", (d) => d.accept());
await owner.click("[data-testid=remove-member]");
ok("owner removes the staff member", !!(await owner.waitForSelector("[data-testid=key-reset]", { timeout: 20000 }).catch(() => null)));
ok("their client goes back to shared", (await prisma.client.findUnique({ where: { id: avery.id } })).assignedToId === null);
await staff.goto(BASE + "/clients");
ok("removed staff no longer see the team's clients", !(await staff.isVisible("text=Avery")));
ok("owner can't be removed", (await owner.request.post(`${BASE}/api/team/members/${(await prisma.user.findUnique({ where: { email: `owner${stamp}@example.com` } })).id}/remove`, { data: {} })).status() === 403);

// Now Solo works, and drops the extra staff item.
ok("downgrade to Solo once alone", (await owner.request.post(BASE + "/api/billing/checkout", { data: { plan: "SOLO" } })).ok());
ok("extra staff item removed on Solo", !state.subs.find((s) => s.id === sub.id).items.data.some((i) => i.price.lookup_key?.startsWith("sureframe_staff_seat")));

// Solo: buying lots of extra clients suggests Studio.
await owner.goto(BASE + "/clients");
await owner.selectOption("select >> nth=0", "5");
ok("no Studio hint for a few extra clients", !(await owner.isVisible("[data-testid=studio-hint]")));
await owner.selectOption("select >> nth=0", "25");
ok("Studio suggested once Solo would cost about the same", await owner.isVisible("[data-testid=studio-hint]"));
ok("hint shows the Solo total", /\$52\.50\/month/.test(await owner.textContent("[data-testid=studio-hint]")));
await owner.screenshot({ path: `${process.argv[2] ?? "/tmp"}/studio-hint.png`, fullPage: true });

await browser.close();
server.close();
await prisma.$disconnect();
