// Removing a staff member resets every key and client link. Remaining
// devices and clients pick up the new keys on their own; the removed person's
// copies of links and keys stop working. Run against a server using the fake
// Stripe (same env as billing.mjs) and a fake camera.
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";
import { start, state, createSubscription } from "./fake-stripe.mjs";
import { agreed } from "./agree.mjs";
import { chooseClients, sendByLink } from "./send.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const shots = process.argv[2] ?? "/tmp";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const server = await start();
const sig = new Stripe("sk_test_fake");
const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args });
const stamp = Date.now();
const perms = { permissions: ["camera", "microphone", "clipboard-read", "clipboard-write"] };
const clip = (p) => p.evaluate(() => navigator.clipboard.readText());
const finiteDuration = (el) => new Promise((r) => {
  const check = () => (Number.isFinite(el.duration) && el.duration > 0 ? r(el.duration) : setTimeout(check, 200));
  check();
  setTimeout(() => r(el.duration), 10000);
});
async function signIn(page, email, next) {
  // Agreed to the current Terms and Privacy Policy, so signing in isn't stopped at /agree (e2e/agree.mjs).
  await agreed(email);
  await page.goto(`${BASE}/login?next=${next}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === next);
}

// Owner on Studio, with a recording sent to Avery and a shared to-do.
const owner = await (await browser.newContext(perms)).newPage();
await signIn(owner, `rk-owner${stamp}@example.com`, "/record");
const recoveryKey = await owner.getAttribute("[data-recovery-key]", "data-recovery-key");
await owner.click("text=I've saved it");
await owner.request.post(BASE + "/api/billing/checkout", { data: { plan: "STUDIO" } });
const session = state.sessions.at(-1).params;
const workspaceId = session.subscription_data.metadata.workspaceId;
const sub = createSubscription(session.customer, workspaceId, "sureframe_studio_monthly");
const payload = JSON.stringify({ id: `evt_${stamp}`, object: "event", type: "customer.subscription.created", data: { object: sub } });
await owner.request.post(BASE + "/api/webhooks/stripe", { headers: { "stripe-signature": sig.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" }), "content-type": "application/json" }, data: payload });

await owner.goto(BASE + "/clients");
for (const [name, email] of [["Avery", `avery${stamp}@example.com`], ["Blake", ""]]) {
  await owner.fill('input[aria-label="Client name"]', name);
  await owner.fill('input[aria-label="Client email"]', email);
  await owner.click("button:has-text('Add client')");
  await owner.waitForSelector(`a:has-text('${name}')`);
}
const avery = await prisma.client.findFirst({ where: { workspaceId, name: "Avery" } });
const blake = await prisma.client.findFirst({ where: { workspaceId, name: "Blake" } });

await owner.goto(BASE + "/record");
await owner.click("text=Camera only");
await owner.click("text=Start recording");
await owner.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await owner.waitForTimeout(3000);
await owner.click("button:has-text('Stop')");
await owner.waitForURL("**/v/**", { timeout: 30000 });
const videoUrl = owner.url().split("?")[0];
// Wait for the choice to be saved before leaving the page.
await chooseClients(owner, avery.name);
await Promise.all([
  owner.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/api/videos/"), { timeout: 30000 }),
  owner.click("[data-testid=send-link]"),
]);

await owner.goto(`${BASE}/clients/${avery.id}`);
await owner.fill('textarea[aria-label="New to-do"]', "Log your sleep");
await owner.check("text=Share with Avery");
await owner.click("form >> button:has-text('Add')");
await owner.waitForSelector('li:has-text("Log your sleep")');
await owner.uncheck("text=Share with Avery");
await owner.fill('textarea[aria-label="New to-do"]', "Team-only note on Avery");
await owner.click("form >> button:has-text('Add')");
await owner.waitForSelector('li:has-text("Team-only note on Avery")');
await owner.click("text=Copy personal link");
const averyOldLink = await clip(owner);

// Avery's phone opens their link and the video.
const averyCtx = await browser.newContext(perms);
const phone = await averyCtx.newPage();
await phone.goto(averyOldLink);
await phone.waitForURL("**/inbox**");
await phone.waitForSelector("text=Log your sleep", { timeout: 15000 });
ok("client reads their shared to-do before the reset", true);

// A staff member joins, sees Avery and copies their link.
await owner.goto(BASE + "/settings/team");
await owner.click("text=Create invite link");
const invite = await (await owner.waitForSelector("[data-testid=invite-link]")).textContent();
const staffCtx = await browser.newContext(perms);
const staff = await staffCtx.newPage();
await staff.goto(invite);
await staff.click("text=Sign in to join");
await agreed(`rk-staff${stamp}@example.com`, { name: null });
await staff.fill('input[name="email"]', `rk-staff${stamp}@example.com`);
await staff.click("text=Continue");
await staff.waitForURL((u) => u.pathname.startsWith("/join/"));
await staff.fill("[data-testid=join-name]", "Team member 1");
await staff.click("text=Join the team");
await staff.waitForURL((u) => u.pathname === "/library");
// Members see only the clients assigned to them.
const joined = await prisma.user.findUnique({ where: { email: `rk-staff${stamp}@example.com` } });
await owner.request.patch(`${BASE}/api/clients/${avery.id}`, { data: { assignedToId: joined.id } });
await staff.goto(`${BASE}/clients/${avery.id}`);
await staff.waitForSelector("text=Team-only note on Avery");
await staff.click("text=Copy personal link");
const staffCopy = await clip(staff);
ok("staff copied Avery's full link", staffCopy === averyOldLink);
const staffUser = await prisma.user.findUnique({ where: { email: `rk-staff${stamp}@example.com` } });
// The staff member records a video for Avery and writes in its conversation: after they're removed, it's a
// former team member's, not the owner's.
await staff.goto(BASE + "/record");
await staff.click("text=Camera only");
await staff.click("text=Start recording");
await staff.waitForSelector("text=/Recording · \\d/", { timeout: 15000 });
await staff.waitForTimeout(2500);
await staff.click("button:has-text('Stop')");
await staff.waitForURL("**/v/**", { timeout: 30000 });
const staffVideoId = staff.url().split("/v/")[1].split("?")[0];
await sendByLink(staff, avery.name);
await prisma.video.update({ where: { id: staffVideoId }, data: { sentAt: new Date() } });
const staffReply = await prisma.reply.create({ data: { kind: "TEXT", body: "sealed".padEnd(40, "x"), encrypted: true, authorName: "Team member 1", videoId: staffVideoId, authorUserId: joined.id } });
const pendingInvite = await owner.request.post(BASE + "/api/team/invites", { data: { teamKeyWrap: "x".repeat(44) } });
ok("an invite is waiting", pendingInvite.status() === 201);

// A second owner device, signed in but still holding no key, for the old recovery key later.
const laptop = await (await browser.newContext()).newPage();
await signIn(laptop, `rk-owner${stamp}@example.com`, "/library");

// Remove the staff member.
const before = await prisma.workspace.findUnique({ where: { id: workspaceId } });
const outboxBefore = new Set(readdirSync(".data/outbox"));
await owner.goto(BASE + "/settings/team");
// An in-page confirmation listing the clients whose links change (not the browser's own box).
await owner.click("[data-testid=remove-member]");
await owner.waitForSelector("[data-testid=team-dialog]");
ok("removing asks first, in the page", await owner.isVisible("[data-testid=team-dialog] >> text=every client gets a new personal link"));
ok("dialog: Avery (opened, has email) is emailed", (await owner.textContent("[data-testid=remove-emailed]")).includes("Avery"));
ok("dialog: Blake (never opened) gets a first link from the team", (await owner.textContent("[data-testid=remove-first-link]")).includes("Blake"));
await owner.click("[data-testid=dialog-confirm]");
await owner.waitForSelector("[data-testid=key-reset]", { timeout: 20000 });
await owner.screenshot({ path: `${shots}/key-reset.png`, fullPage: true });
const after = await prisma.workspace.findUnique({ where: { id: workspaceId } });
ok("team key changed", after.keyFingerprint !== before.keyFingerprint && !!after.keyFingerprint);
ok("staff removed", !(await prisma.membership.findFirst({ where: { workspaceId, userId: staffUser.id } })));
ok("pending invites cancelled", (await prisma.invite.count({ where: { workspaceId, acceptedAt: null, revokedAt: null } })) === 0);
const avery2 = await prisma.client.findUnique({ where: { id: avery.id } });
ok("Avery has a new link token", avery2.token !== avery.token);
ok("Avery has a new key", !!avery2.keyFingerprint && avery2.teamKeyWrap !== avery.teamKeyWrap);
ok("panel lists Blake (never opened) to send as a first link", await owner.isVisible("[data-testid=reset-first-link] >> text=Blake"));
ok("panel doesn't list Avery (emailed)", !(await owner.isVisible("[data-testid=key-reset] >> text=Avery")));
ok("panel shows a new recovery key", (await owner.textContent("[data-testid=new-recovery-key]")).replace(/\s/g, "") !== recoveryKey);
const newMail = readdirSync(".data/outbox").filter((f) => !outboxBefore.has(f)).map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8")));
const averyMail = newMail.find((m) => m.to === `avery${stamp}@example.com`);
ok("Avery emailed a new link", !!averyMail && averyMail.text.includes(`/c/${avery2.token}`));
ok("emailed link carries no key", !!averyMail && !averyMail.text.includes("#k="));
ok("the email says the link was replaced and where it opens", !!averyMail && averyMail.text.includes("replaced your personal link") && averyMail.text.includes("you used before"));
ok("Blake, who never opened a link, isn't emailed one", !newMail.some((m) => m.text.includes(`/c/`) && m.to !== `avery${stamp}@example.com` && m.text.includes("new link")));
ok("the removed staff member is emailed", newMail.some((m) => m.to === `rk-staff${stamp}@example.com` && m.subject.includes("no longer on")));
// Their recording and reply stay with the business, shown as a former team member's.
const staffVideo = await prisma.video.findUnique({ where: { id: staffVideoId } });
ok("their video moved to the owner, marked as a former team member's", !!staffVideo.formerStaffAt && staffVideo.ownerId !== joined.id);
const replies = await (await owner.request.get(`${BASE}/api/videos/${staffVideoId}/replies`)).json();
const former = replies.replies.find((r) => r.id === staffReply.id);
ok("their reply reads Former team member, and isn't the owner's own", former?.authorName === "Former team member" && former.mine === false, JSON.stringify(former));

// The removed staff member's copies stop working.
const staffTry = await (await browser.newContext()).newPage();
await staffTry.goto(staffCopy);
ok("old link refused, saying it was replaced", staffTry.url().includes("replaced=1") && !!(await staffTry.waitForSelector("[data-testid=client-link-replaced]", { timeout: 10000 }).catch(() => null)));
ok("removed staff can't fetch Avery's key chain", (await staff.request.get(`${BASE}/api/clients/${avery.id}/key`)).status() === 404);
await staff.goto(videoUrl);
ok("removed staff can't open the video", !(await staff.isVisible("main video")));
ok("and are told they were removed, not to open a personal link", !!(await staff.waitForSelector("[data-testid=video-former-member]", { timeout: 10000 }).catch(() => null)));

// Stale tabs can't write with the old key.
const stale = await owner.request.post(BASE + "/api/clients", { data: { name: "Late", teamKeyWrap: "x".repeat(44), keyFingerprint: before.keyFingerprint } });
ok("write sealed with the old key refused", stale.status() === 409);

// Before opening it, Avery's phone (still holding the old link) says the link was replaced.
await phone.goto(BASE + "/inbox");
ok("client's device with the old link is told it was replaced", !!(await phone.waitForSelector("[data-testid=client-link-replaced]", { timeout: 10000 }).catch(() => null)));
// Avery opens the emailed link (no key in it) on the same phone: the device's old key catches up.
const newLink = averyMail.text.match(/https?:\/\/\S+\/c\/\S+/)[0];
await phone.goto(newLink);
await phone.waitForURL("**/inbox**");
await phone.waitForSelector("text=Log your sleep", { timeout: 15000 });
ok("client reads shared to-do after the reset", true);
await phone.goto(videoUrl);
await phone.waitForSelector("main video", { timeout: 30000 });
ok("client plays the video after the reset", (await phone.$eval("main video", finiteDuration)) > 1);
await phone.goto(BASE + "/inbox");
await phone.waitForSelector("[data-testid=inbox-video]", { timeout: 15000 });
ok("client's inbox: the removed member's video reads Former team member · business", (await phone.textContent("main")).includes("Former team member ·"));
await phone.goto(`${BASE}/v/${staffVideoId}`);
ok("client's video page too", (await phone.textContent("[data-testid=video-meta]", { timeout: 20000 })).includes("Former team member ·"));

// Blake's new link from the panel works on a fresh device.
await owner.click("[data-testid=key-reset] li:has-text('Blake') >> text=Copy new link");
const blakeNew = await clip(owner);
ok("Blake's new link carries a key", /\/c\/[\w-]+#k=/.test(blakeNew) && !blakeNew.includes(blake.token));
await owner.goto(`${BASE}/v/${staffVideoId}`);
ok("owner's video page: Former team member · business", (await owner.textContent("[data-testid=video-meta]", { timeout: 20000 })).includes("Former team member ·"));
await owner.goto(`${BASE}/library`);
ok("owner's library card says so too", !!(await owner.waitForSelector("[data-testid=video-former]", { timeout: 15000 }).catch(() => null)));

// The owner still reads everything.
await owner.goto(`${BASE}/clients/${avery.id}`);
await owner.waitForSelector("text=Team-only note on Avery");
ok("owner reads private and shared items", (await owner.isVisible("text=Log your sleep")) && !(await owner.isVisible("text=[Couldn't unlock]")));
await owner.goto(videoUrl);
await owner.waitForSelector("main video", { timeout: 20000 });
ok("owner plays the video", (await owner.$eval("main video", finiteDuration)) > 1);

// The owner's other device unlocks with the recovery key saved before the reset.
await laptop.goto(BASE + "/library");
await laptop.fill('input[aria-label="Recovery key"]', recoveryKey);
await laptop.click("button:has-text('Unlock')");
await laptop.waitForSelector("text=To-dos & notes", { timeout: 10000 });
const laptopKey = await laptop.evaluate((id) => localStorage.getItem(`framecast.key.team:${id}`), workspaceId);
const ownerKey = await owner.evaluate((id) => localStorage.getItem(`framecast.key.team:${id}`), workspaceId);
ok("old recovery key leads current members to the new key", laptopKey === ownerKey);

// Someone who deletes their own account leaves holding the keys: admins are asked to reset.
await owner.goto(BASE + "/settings/team");
await owner.click("text=Create invite link");
const invite2 = await (await owner.waitForSelector("[data-testid=invite-link]")).textContent();
const leaver = await (await browser.newContext()).newPage();
await leaver.goto(invite2);
await leaver.click("text=Sign in to join");
await agreed(`rk-leaver${stamp}@example.com`);
await leaver.fill('input[name="email"]', `rk-leaver${stamp}@example.com`);
await leaver.click("text=Continue");
await leaver.waitForURL((u) => u.pathname.startsWith("/join/"));
await leaver.click("text=Join the team");
await leaver.waitForURL((u) => u.pathname === "/library");
await leaver.goto(BASE + "/settings/account");
await leaver.fill('input[name="confirm"]', `rk-leaver${stamp}@example.com`);
await leaver.click("text=Delete my account");
await leaver.click("[data-testid=delete-account-yes]");
await leaver.waitForURL((u) => u.pathname === "/login");
await owner.goto(BASE + "/settings/team");
ok("owner asked to reset after a self-deletion", !!(await owner.waitForSelector("text=left the team and still holds its keys", { timeout: 10000 }).catch(() => null)));
const fp2 = (await prisma.workspace.findUnique({ where: { id: workspaceId } })).keyFingerprint;
await owner.click("text=Reset keys now");
await owner.waitForSelector("[data-testid=key-reset]", { timeout: 20000 });
const ws3 = await prisma.workspace.findUnique({ where: { id: workspaceId } });
ok("reset clears the prompt and changes the key", ws3.keyFingerprint !== fp2 && ws3.keyResetNeeded === null);
await phone.goto(BASE + "/inbox");
ok("client's old cookie stops working after the second reset", !(await phone.isVisible("text=Log your sleep")));

await browser.close();
server.close();
await prisma.$disconnect();
