// Team plans: staff invites with the team key handed over in the link's
// #fragment, roles, client assignment, staff limits and the Solo->Studio hint.
// Run against a server using the fake Stripe (same env as billing.mjs).
import { chromium } from "@playwright/test";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { start, state, createSubscription } from "./fake-stripe.mjs";
import { agreed } from "./agree.mjs";
import { readdirSync, readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
// Emails written to the local outbox since `since` (a set of file names), as { to, subject, text }.
const outbox = () => new Set(readdirSync(".data/outbox"));
const waitFor = async (fn, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
    const v = await fn();
    if (v) return v;
  }
  return null;
};
const mailSince = (since) => [...outbox()].filter((f) => !since.has(f)).map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8")));
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
ok("Free plan: no dead invite form", (await owner.locator('input[aria-label="Staff email"]').count()) === 0);

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
ok("Studio shows 3 staff logins", /1\s*on the team/.test(await owner.textContent("[data-testid=staff-logins]")) && /2 of 3 logins free/.test(await owner.textContent("[data-testid=staff-logins-detail]")), await owner.textContent("main"));
ok("no login purchase while included logins are free", !(await owner.isVisible("select[aria-label='Extra staff logins']")));
ok("the invite text and the owner-only rules agree", (await owner.textContent("main")).includes("Only the owner can add staff logins or change the plan"));
const beforeInvite = outbox();
await owner.fill('input[aria-label="Staff email"]', `staff${stamp}@example.com`);
await owner.click("text=Create invite link");
const link = await (await owner.waitForSelector("[data-testid=invite-link]")).textContent();
ok("the counter says an invite is waiting, not that two people are on the team", /1\s*on the team/.test(await owner.textContent("[data-testid=staff-logins]")) && /1 invite waiting to join/.test(await owner.textContent("[data-testid=staff-logins-detail]")));
const inviteMail = mailSince(beforeInvite).find((m) => m.to === `staff${stamp}@example.com`);
ok("the invited person is emailed to expect the link", !!inviteMail && /invited you to join/.test(inviteMail.subject), JSON.stringify(inviteMail));
ok("the invite email has no join link or key", !!inviteMail && !inviteMail.text.includes("/join/") && !inviteMail.text.includes("#k=") && !inviteMail.html.includes("/join/"));
ok("the page says they were emailed", (await owner.textContent("[data-testid=invite-created]")).includes(`We've emailed staff${stamp}@example.com`));
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
await agreed(`staff${stamp}@example.com`, { name: null });
await staff.fill('input[name="email"]', `staff${stamp}@example.com`);
await staff.click("text=Continue");
await staff.waitForURL((u) => u.pathname.startsWith("/join/"));
ok("after sign-in the fragment is gone but the key was kept", !staff.url().includes("#k="));
ok("the join page says the key was kept in this browser", (await staff.textContent("[data-testid=join-key-note]")).includes("kept in this browser"));
await staff.fill("[data-testid=join-name]", "Team member 1");
await staff.click("text=Join the team");
await staff.waitForURL((u) => u.pathname === "/library");
ok("new staff are shown the recovery key to save", !!(await staff.waitForSelector("[data-testid=recovery-key-box]", { timeout: 15000 }).catch(() => null)));
await staff.click("[data-testid=recovery-key-box] >> text=I've saved it");
ok("and their I've saved it is kept for them", !!(await waitFor(async () => (await prisma.membership.findFirst({ where: { workspaceId, user: { email: `staff${stamp}@example.com` } } }))?.recoveryKeySavedAt)));
ok("the name given on the invite page is kept", (await prisma.user.findUnique({ where: { email: `staff${stamp}@example.com` } })).name === "Team member 1");
ok("staff first screen is about assigned clients, not adding them", await staff.isVisible("[data-testid=staff-start]") && !(await staff.isVisible("[data-testid=start-here]")));
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
ok("staff aren't shown the business's client seat count", !(await staff.isVisible("text=Client seats")));
await staff.goto(BASE + "/settings/team");
await staff.waitForURL((u) => u.pathname === "/team", { timeout: 15000 }).catch(() => {});
ok("a member's /settings/team is their Team page", new URL(staff.url()).pathname === "/team", staff.url());
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
ok("assigning says Saved", (await owner.textContent("[data-testid=assign-saved]").catch(() => "")).includes("Saved"));
await staff.goto(BASE + "/clients");
await staff.waitForSelector("text=Avery");
ok("staff sees the client once it's assigned to them", await staff.isVisible("a:has-text('Avery')") && !(await staff.isVisible("text=/All clients \\(/")));

// Role and permission changes say Saved, and an admin is told what only the owner can do.
await owner.goto(BASE + "/settings/team");
await owner.selectOption(`select[aria-label="Role for Team member 1"]`, "ADMIN");
ok("role change says Saved", !!(await owner.waitForSelector("[data-testid=member-saved] >> text=is now an admin", { timeout: 10000 }).catch(() => null)));
await staff.goto(BASE + "/settings/team");
ok("the admin is told only the owner adds logins", !!(await staff.waitForSelector("[data-testid=admin-limits]", { timeout: 15000 }).catch(() => null)));
await owner.selectOption(`select[aria-label="Role for Team member 1"]`, "MEMBER");
await owner.waitForSelector("[data-testid=member-saved] >> text=is now a member");
await owner.click("input[aria-label='See all clients for Team member 1']");
ok("permission change says Saved", !!(await owner.waitForSelector("[data-testid=member-saved] >> text=can now see all clients", { timeout: 10000 }).catch(() => null)));
await owner.click("input[aria-label='See all clients for Team member 1']");
await owner.waitForSelector("[data-testid=member-saved] >> text=can no longer see all clients");

// Staff limit: owner + staff + one invite = 3 on Studio.
const mk = () => owner.request.post(BASE + "/api/team/invites", { data: { teamKeyWrap: "x".repeat(44) } });
const third = await mk();
ok("third login can be invited", third.status() === 201);
ok("fourth is refused at Studio's limit", (await mk()).status() === 402);
const { invite: pending } = await third.json();
await owner.request.delete(`${BASE}/api/team/invites/${pending.id}`);
ok("cancelling an invite frees the login", (await mk()).status() === 201);
await owner.goto(BASE + "/settings/team");
ok("with every login in use, Need more? appears", !!(await owner.waitForSelector("select[aria-label='Extra staff logins']", { timeout: 15000 }).catch(() => null)));

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
await owner.click("[data-testid=delete-account-yes]");
await owner.waitForURL((u) => u.searchParams.get("error") === "team");
ok("owner with staff can't delete their account", !!(await prisma.user.findUnique({ where: { email: `owner${stamp}@example.com` } })));

// Removing staff puts their clients back in the shared list.
for (const i of await prisma.invite.findMany({ where: { workspaceId, acceptedAt: null, revokedAt: null } })) await owner.request.delete(`${BASE}/api/team/invites/${i.id}`);
await owner.goto(BASE + "/settings/team");
// An in-page confirmation listing the clients whose links change (not the browser's own box).
await owner.click("[data-testid=remove-member]");
await owner.waitForSelector("[data-testid=team-dialog]");
ok("removing asks first, in the page", await owner.isVisible("[data-testid=team-dialog] >> text=every client gets a new personal link"));
const beforeRemove = outbox();
await owner.click("[data-testid=dialog-confirm]");
ok("owner removes the staff member", !!(await owner.waitForSelector("[data-testid=key-reset]", { timeout: 20000 }).catch(() => null)));
const removedMail = mailSince(beforeRemove).find((m) => m.to === `staff${stamp}@example.com`);
ok("the removed person is emailed", !!removedMail && removedMail.subject.includes("no longer on"), JSON.stringify(removedMail));
ok("the new recovery key has a save step", await owner.isVisible("[data-testid=new-key-box] >> text=I've saved it"));
await owner.click("[data-testid=new-key-saved-button]");
ok("and saving it says so", !!(await owner.waitForSelector("[data-testid=new-key-saved]", { timeout: 10000 }).catch(() => null)));
ok("their client goes back to shared", (await prisma.client.findUnique({ where: { id: avery.id } })).assignedToId === null);
await staff.goto(BASE + "/clients");
ok("removed staff no longer see the team's clients", !(await staff.isVisible("text=Avery")));
await staff.goto(link.split("#")[0]);
ok("their old invite says they were removed, not Join", !!(await staff.waitForSelector("[data-testid=join-removed]", { timeout: 15000 }).catch(() => null)) && !(await staff.isVisible("text=Join the team")));
// On Studio, the Team overview stays when the owner is on their own again.
await owner.goto(BASE + "/team");
ok("Team overview stays for an owner on their own", !!(await owner.waitForSelector("[data-testid=team-alone]", { timeout: 15000 }).catch(() => null)) && new URL(owner.url()).pathname === "/team");
ok("and Team stays in the menu", (await owner.locator("header nav a").evaluateAll((els) => els.map((e) => e.getAttribute("href")))).includes("/team"));
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
