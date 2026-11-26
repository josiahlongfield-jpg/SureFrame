// Server-copy expiry: the Library shows when each recording's encrypted copy
// is deleted (in the viewer's time zone), "Saved to cloud backup" or "Deleted
// from our servers", and a "Deleting soon" filter (within 7 days, soonest
// first, only what this person may see). The reminders job emails each
// recorder once (or, once they can no longer open it, whoever looks after its client now: SEC-7), ~24 hours ahead,
// grouped into one email, naming each by its title, with their clients' video and voice replies due then as a line per
// conversation (MAIL-8; replies alone get no email, and are never held a day),
// and never for cloud-backup workspaces, the team's own replies or already-deleted copies.
// One due with no warning sent is kept one more day so the warning goes first, once (MAIL-3).
//
// Run against a dev server with no RESEND_API_KEY (mail goes to .data/outbox)
// and CRON_SECRET set:
//   CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome CRON_SECRET=... BASE=http://localhost:3000 node e2e/expiry.mjs [screenshot dir]
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret";
const shots = process.argv[2] ?? "/tmp";
const TZ = "America/New_York";
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${cond ? "" : ` ${extra}`}`);
  if (!cond) process.exitCode = 1;
};
const prisma = new PrismaClient();
await prisma.rateLimit.deleteMany();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const stamp = Date.now();
const H = 3_600_000;
const D = 24 * H;
const outbox = () => (existsSync(".data/outbox") ? readdirSync(".data/outbox").sort().map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8"))) : []);
const norm = (s) => s.replace(/[\s  ]+/g, " ").trim();
const local = (d) => norm(d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: TZ }));
const cron = async (path = "reminders", secret = CRON) => {
  const r = await fetch(`${BASE}/api/cron/${path}`, { headers: secret ? { Authorization: `Bearer ${secret}` } : {} });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
};

async function signIn(email, next = "/library") {
  // Agreed to the current Terms and Privacy Policy, so signing in isn't stopped at /agree (e2e/agree.mjs).
  await agreed(email);
  const page = await (await browser.newContext({ timezoneId: TZ, viewport: { width: 1360, height: 1000 } })).newPage();
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await page.fill('input[name="email"]', email);
  await page.click("text=Continue");
  await page.waitForURL((u) => u.pathname === next.split("?")[0]);
  // The page has rendered, so the new account's workspace exists.
  await page.waitForSelector("main h1", { timeout: 30000 });
  return page;
}

// ---- An owner (Solo, no cloud backup) and a staff member recording too ----
const ownerEmail = `ex-owner${stamp}@example.com`;
const owner = await signIn(ownerEmail);
const ownerUser = await prisma.user.findUnique({ where: { email: ownerEmail }, include: { memberships: true } });
const workspaceId = ownerUser.memberships[0].workspaceId;
await prisma.workspace.update({ where: { id: workspaceId }, data: { plan: "SOLO", name: `Peak ${stamp}` } });
const staffEmail = `ex-staff${stamp}@example.com`;
const staffUser = await prisma.user.create({ data: { email: staffEmail, activeWorkspaceId: workspaceId, memberships: { create: { workspaceId, role: "MEMBER" } } } });
const client = await prisma.client.create({ data: { name: `Ana ${stamp}`, token: `tok${stamp}a`, workspaceId } });
const client2 = await prisma.client.create({ data: { name: `Ben ${stamp}`, token: `tok${stamp}b`, workspaceId } });

const now = Date.now();
const vid = (suffix, data) =>
  prisma.video.create({
    data: { id: `ex${stamp.toString(36)}${suffix}`.slice(0, 20), mimeType: "video/webm", storageKey: `test/${stamp}/${suffix}`, status: "UPLOADED", workspaceId, ownerId: ownerUser.id, title: `Secret title ${suffix} ${stamp}`, ...data },
  });
const soon1 = await vid("s1", { purgeAt: new Date(now + 20 * H), createdAt: new Date(now + 20 * H - 30 * D), clientId: client.id });
const soon1copy = await vid("s1c", { purgeAt: new Date(now + 20 * H), createdAt: new Date(now + 20 * H - 30 * D), clientId: client2.id, sourceId: soon1.id });
const soon2 = await vid("s2", { purgeAt: new Date(now + 23 * H) });
const in3days = await vid("d3", { purgeAt: new Date(now + 3 * D + 2 * H) });
const in10days = await vid("d10", { purgeAt: new Date(now + 10 * D) });
const expired = await vid("x", { status: "EXPIRED", purgeAt: new Date(now - D) });
const reply = await vid("r", { purgeAt: new Date(now + 10 * H), replyToId: soon2.id });
const staffVid = await vid("st", { purgeAt: new Date(now + 22 * H), ownerId: staffUser.id });

// ---- Library: status text in the viewer's time zone ----
await owner.goto(BASE + "/library");
// The library groups videos by day; open every day's folder.
await owner.$$eval("[data-testid=day-folder]", (els) => els.forEach((e) => (e.open = true)));
const statusOf = async (id) => {
  const el = await owner.waitForSelector(`a[href="/v/${id}"] [data-testid=storage-status]:not(:empty)`);
  await owner.waitForFunction((e) => e.textContent.trim().length > 1, el);
  return { text: norm(await el.textContent()), soon: (await el.getAttribute("data-soon")) === "true" };
};
const s3 = await statusOf(in3days.id);
ok("normal: deletion date and time in local time zone", s3.text.startsWith(`Deletes from our servers on ${local(in3days.purgeAt)}`), s3.text);
ok("normal: relative hint", /in 3 days$/.test(s3.text), s3.text);
ok("normal: not amber beyond 48 hours", !s3.soon);
const sS = await statusOf(soon2.id);
ok("under 48 hours: amber with hours hint", sS.soon && /in 2[23] hours$/.test(sS.text), sS.text);
ok("expired: deleted from our servers", (await statusOf(expired.id)).text === "Deleted from our servers");
ok("more than a week away: no line on the card, the date is said once at the top", (await owner.locator(`a[href="/v/${in10days.id}"] [data-testid=storage-status]`).count()) === 0 && norm(await owner.textContent("[data-testid=deletion-note]")).includes("deleted from our servers 30 days after"));
await owner.screenshot({ path: `${shots}/expiry-library.png`, fullPage: true });

// ---- Deleting soon filter ----
await owner.click("role=navigation[name='Filter videos'] >> text=Deleting soon");
await owner.waitForURL((u) => u.searchParams.get("filter") === "soon");
const listed = await owner.$$eval("main ul > li > a", (as) => as.map((a) => a.getAttribute("href").replace("/v/", "")));
ok("deleting soon: within 7 days, soonest first, no expired/replies/copies", JSON.stringify(listed) === JSON.stringify([soon1.id, staffVid.id, soon2.id, in3days.id]), JSON.stringify(listed));
ok("deleting soon tab shows its count", (await owner.textContent("role=navigation[name='Filter videos'] >> [aria-current=page]")).includes("(4)"));
await owner.screenshot({ path: `${shots}/expiry-soon.png`, fullPage: true });

// Restricted staff only see what they may (their own recording, their clients' videos).
const staff = await signIn(staffEmail, "/library?filter=soon");
await staff.waitForSelector(`a[href="/v/${staffVid.id}"]`, { timeout: 10000 }).catch(() => {});
await staff.screenshot({ path: `${shots}/expiry-staff.png`, fullPage: true });
const staffListed = await staff.$$eval("main ul > li > a", (as) => as.map((a) => a.getAttribute("href").replace("/v/", "")));
ok("staff deleting soon respects permissions", JSON.stringify(staffListed) === JSON.stringify([staffVid.id]), JSON.stringify(staffListed));

// ---- Cloud backup workspace ----
const cloudEmail = `ex-cloud${stamp}@example.com`;
const cloud = await signIn(cloudEmail);
const cloudUser = await prisma.user.findUnique({ where: { email: cloudEmail }, include: { memberships: true } });
const cloudWs = cloudUser.memberships[0].workspaceId;
await prisma.workspace.update({ where: { id: cloudWs }, data: { plan: "SOLO", cloudBackup: true } });
const kept = await prisma.video.create({ data: { id: `ek${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/k`, status: "UPLOADED", workspaceId: cloudWs, ownerId: cloudUser.id, purgeAt: null } });
// A stale purgeAt in a cloud-backup workspace must still never be warned about.
const keptStale = await prisma.video.create({ data: { id: `eks${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/ks`, status: "UPLOADED", workspaceId: cloudWs, ownerId: cloudUser.id, purgeAt: new Date(now + 10 * H) } });
await cloud.goto(BASE + "/library");
// The library groups videos by day; open every day's folder.
await cloud.$$eval("[data-testid=day-folder]", (els) => els.forEach((e) => (e.open = true)));
await cloud.waitForSelector(`a[href="/v/${kept.id}"]`);
ok("cloud backup: said once at the top, not on every card", norm(await cloud.textContent("[data-testid=deletion-note]")).startsWith("Cloud backup is on") && (await cloud.locator("main [data-testid=storage-status]").count()) === 0);

// MAIL-8: a client's video and voice replies due within 24 hours go in the same email, as a line per conversation.
// Not the team's own replies, nor one the client is still reviewing (held).
const conv = await vid("cv", { purgeAt: new Date(now + 15 * D), createdAt: new Date(now - 15 * D), clientId: client.id });
const replyMedia = async (suffix, reply) => {
  const media = await vid(suffix, { purgeAt: new Date(now + 21 * H), replyToId: conv.id, title: `Reply from Ana ${stamp}` });
  await prisma.reply.create({ data: { kind: "VIDEO", authorName: `Ana ${stamp}`, videoId: conv.id, mediaId: media.id, ...reply } });
  return media;
};
const anaReply1 = await replyMedia("ar1", { byClient: true });
const anaReply2 = await replyMedia("ar2", { byClient: true });
const teamReply = await replyMedia("tr", { byClient: false, authorUserId: ownerUser.id, authorName: "Owner" });
const heldReply = await replyMedia("hr", { byClient: true, heldAt: new Date() });

// SEC-7: a recording goes with its client. One the staff member recorded for a client now looked after by someone else is
// that person's to be warned about, not the recorder's (who can no longer open it).
const staff2Email = `ex-staff2${stamp}@example.com`;
const staff2 = await prisma.user.create({ data: { email: staff2Email, activeWorkspaceId: workspaceId, memberships: { create: { workspaceId, role: "MEMBER" } } } });
const movedClient = await prisma.client.create({ data: { name: `Cy ${stamp}`, token: `tok${stamp}c`, workspaceId, assignedToId: staff2.id } });
const movedVid = await vid("mv", { purgeAt: new Date(now + 21 * H), ownerId: staffUser.id, clientId: movedClient.id });

// ---- The 24-hour warning ----
const before = outbox().length;
ok("warning job needs the secret", (await cron("reminders", "")).status === 401);
const run1 = await cron();
const mails = outbox().slice(before).filter((m) => [ownerEmail, staffEmail, cloudEmail].includes(m.to));
const toOwner = mails.filter((m) => m.to === ownerEmail);
const toStaff = mails.filter((m) => m.to === staffEmail);
ok("job reports warnings sent", run1.body?.expiryWarnings >= 2, JSON.stringify(run1.body));
ok("owner gets exactly one grouped email", toOwner.length === 1, String(toOwner.length));
const m = toOwner[0] ?? { subject: "", text: "", html: "" };
// The soonest of the two is 20 hours away, not 24: a late warning says how long is really left (MAIL-3).
ok("subject says how long is left for the soonest", /^2 recordings are deleted from SureFrame, the first in (19|20) hours$/.test(m.subject) && /within 24 hours, the first in about (19|20) hours\./.test(norm(m.text)), m.subject);
ok("lists each recording once (copies merged), with clients", m.text.includes(`sent to Ana ${stamp}, Ben ${stamp}`) && m.text.split(`/v/${soon1.id}`).length === 2 && m.text.includes(`/v/${soon2.id}`), m.text);
ok("not the 3-day, 10-day, expired or reply videos", ![in3days, in10days, expired, reply, soon1copy].some((v) => m.text.includes(`/v/${v.id}`)));
// The business had no time zone; the owner's browser set it (components/TimeZoneSync.tsx), so emails use it.
ok("exact deletion time in the business's time zone (from the owner's browser)", norm(m.text).includes(`${local(soon1.purgeAt)} ${new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "short" }).formatToParts(soon1.purgeAt).find((p) => p.type === "timeZoneName").value}`) && m.text.includes(`time zone (${TZ})`), m.text);
ok("advises saving to device", m.text.includes("Save to device") && m.text.includes("can no longer be watched from the link") && !m.text.includes("original stays on"));
ok("owner on a paid plan is told about cloud backup", m.text.includes("/settings/billing"));
// Fix-first 12: each recording is named by its title, not only the date it was recorded (titles aren't encrypted).
ok("each recording is named by its title", m.text.includes(`\u201c${soon1.title}\u201d, recorded`) && m.text.includes(`\u201c${soon2.title}\u201d, recorded`) && m.html.includes(soon1.title), m.text);
ok("titles stay out of the subject", !mails.some((x) => x.subject.includes("Secret title")));
ok("staff recorder gets their own email (not the owner)", toStaff.length === 1 && /^A recording is deleted from SureFrame in (21|22) hours$/.test(toStaff[0].subject) && toStaff[0].text.includes(`/v/${staffVid.id}`) && !toOwner.some((x) => x.text.includes(staffVid.id)));
const toStaff2 = outbox().slice(before).filter((x) => x.to === staff2Email);
ok("a recording for a client someone else looks after now warns them, not its recorder (SEC-7)",
  toStaff2.length === 1 && toStaff2[0].text.includes(`/v/${movedVid.id}`) && toStaff2[0].text.includes(`sent to Cy ${stamp}`) && norm(toStaff2[0].text).includes("made by your team") && !mails.some((x) => x.text.includes(movedVid.id)), JSON.stringify(toStaff2.map((x) => x.text)));
ok("staff aren't sent the billing link", toStaff[0] && !toStaff[0].text.includes("/settings/billing") && toStaff[0].text.includes("team owner"));
ok("no email for the cloud backup workspace", !mails.some((x) => x.to === cloudEmail));
const warned = await prisma.video.findMany({ where: { id: { in: [soon1.id, soon1copy.id, soon2.id, staffVid.id, in3days.id, reply.id, keptStale.id] } }, select: { id: true, expiryWarnedAt: true } });
const w = Object.fromEntries(warned.map((v) => [v.id, !!v.expiryWarnedAt]));
ok("warned state recorded", w[soon1.id] && w[soon1copy.id] && w[soon2.id] && w[staffVid.id] && !w[in3days.id] && !w[reply.id] && !w[keptStale.id], JSON.stringify(w));
// MAIL-8: the client's two replies are one line in the same email, by her name and the video's date (no title, no content).
ok("client replies: one line in the same email, with a link to the conversation", toOwner.length === 1 && norm(m.text).includes(`2 replies from Ana ${stamp}, on the video recorded`) && m.text.includes(`/v/${conv.id}?team=1`) && m.text.split(`/v/${conv.id}`).length === 2, m.text);
ok("client replies: the lead says so, and says to watch them first", norm(m.text).includes("So are 2 video or voice replies from your clients.") && norm(m.text).includes("Watch or listen to the replies before then too."), m.text);
ok("client replies: the conversation's title isn't added for them", !m.text.includes(conv.title));
const rw = await prisma.video.findMany({ where: { id: { in: [anaReply1.id, anaReply2.id, teamReply.id, heldReply.id] } }, select: { id: true, expiryWarnedAt: true } });
const rws = Object.fromEntries(rw.map((v) => [v.id, !!v.expiryWarnedAt]));
ok("client replies warned; not the team's own reply or one still held for review", rws[anaReply1.id] && rws[anaReply2.id] && !rws[teamReply.id] && !rws[heldReply.id], JSON.stringify(rws));

const mid = outbox().length;
await cron();
await cron("purge");
ok("sent exactly once (both jobs run again)", !outbox().slice(mid).some((x) => [ownerEmail, staffEmail].includes(x.to)));

// A video rescheduled into the window later gets its own email. Close to a day ahead, it says "in 24 hours".
await prisma.video.update({ where: { id: in3days.id }, data: { purgeAt: new Date(Date.now() + 23.8 * H) } });
const mid2 = outbox().length;
await cron();
const late = outbox().slice(mid2).filter((x) => x.to === ownerEmail);
ok("a video newly inside the window is warned separately", late.length === 1 && late[0].subject === "A recording is deleted from SureFrame in 24 hours" && late[0].text.includes(`/v/${in3days.id}`));

// ---- MAIL-8: a client's replies only ride along with a recording's warning: never an email of their own ----
const conv2 = await vid("cv2", { purgeAt: new Date(now + 15 * D), createdAt: new Date(now - 15 * D), clientId: client.id });
const lone = await vid("lr", { purgeAt: new Date(Date.now() + 20 * H), replyToId: conv2.id, title: `Lone reply ${stamp}` });
await prisma.reply.create({ data: { kind: "VIDEO", authorName: `Ana ${stamp}`, videoId: conv2.id, mediaId: lone.id, byClient: true } });
const mid4 = outbox().length;
await cron();
const after4 = outbox().slice(mid4);
ok("client replies alone: no email (MAIL-8)", !after4.some((x) => x.text.includes(`/v/${conv2.id}`) || /repl/i.test(x.subject)), JSON.stringify(after4.map((x) => x.subject)));
ok("client replies alone: no bell line, and not marked warned", !(await prisma.video.findUnique({ where: { id: lone.id } })).expiryWarnedAt && (await prisma.notification.count({ where: { workspaceId, kind: "EXPIRING", text: { contains: "repl" } } })) === 0);
await prisma.video.update({ where: { id: lone.id }, data: { purgeAt: new Date(Date.now() - 60_000) } });
await cron("purge");
ok("a client's reply is never held a day for a warning that can't come (MAIL-3)", (await prisma.video.findUnique({ where: { id: lone.id } })).status === "EXPIRED");

// SEC-7: the owner's own recording for a staff member's client is still the owner's to be warned about (they can open it).
const ownerToCy = await vid("oc", { purgeAt: new Date(Date.now() + 23.5 * H), clientId: movedClient.id });
const mid5 = outbox().length;
await cron();
const after5 = outbox().slice(mid5);
ok("an owner's recording sent to a staff member's client warns the owner, not the staff member (SEC-7)",
  after5.some((x) => x.to === ownerEmail && x.text.includes(`/v/${ownerToCy.id}`)) && !after5.some((x) => x.to === staff2Email), JSON.stringify(after5.map((x) => [x.to, x.subject])));

// ---- MAIL-3: due with no warning sent (jobs paused, a hold lifted, email down): kept one more day, warned first ----
const unwarned = await vid("uw", { purgeAt: new Date(Date.now() - 2 * H) });
// Already held a day once and still not warned: deleted on its date, so nothing stays more than a day past it.
const heldOnce = await vid("ho", { purgeAt: new Date(Date.now() - 2 * H), expiryWarnedAt: new Date(0) });
// A cloud-backup workspace's stale date: neither held nor deleted, as before.
const cloudDue = await prisma.video.create({ data: { id: `ekd${stamp.toString(36)}`, mimeType: "video/webm", storageKey: `test/${stamp}/kd`, status: "UPLOADED", workspaceId: cloudWs, ownerId: cloudUser.id, purgeAt: new Date(Date.now() - 2 * H) } });
const mid3 = outbox().length;
await cron("purge");
const uw1 = await prisma.video.findUnique({ where: { id: unwarned.id } });
ok("not warned yet: kept, with its date moved a day on", uw1.status === "UPLOADED" && Math.abs(uw1.purgeAt.getTime() - (Date.now() + D)) < 10 * 60_000, JSON.stringify(uw1.purgeAt));
ok("held once already: deleted on its date", (await prisma.video.findUnique({ where: { id: heldOnce.id } })).status === "EXPIRED");
const cd = await prisma.video.findUnique({ where: { id: cloudDue.id } });
ok("cloud backup: a stale date is neither held nor deleted", cd.status === "UPLOADED" && cd.purgeAt.getTime() === cloudDue.purgeAt.getTime() && !cd.expiryWarnedAt);
await cron();
const heldMail = outbox().slice(mid3).filter((x) => x.to === ownerEmail && x.text.includes(`/v/${unwarned.id}`));
ok("held: the 24-hour warning goes, a day ahead", heldMail.length === 1 && heldMail[0].subject === "A recording is deleted from SureFrame in 24 hours", JSON.stringify(heldMail.map((x) => x.subject)));
ok("held: then marked as warned", (await prisma.video.findUnique({ where: { id: unwarned.id } })).expiryWarnedAt?.getTime() > 0);
await prisma.video.update({ where: { id: unwarned.id }, data: { purgeAt: new Date(Date.now() - 60_000) } });
await cron("purge");
ok("warned: deleted when its new date comes", (await prisma.video.findUnique({ where: { id: unwarned.id } })).status === "EXPIRED");

await prisma.video.deleteMany({ where: { workspaceId: { in: [workspaceId, cloudWs] } } });
await browser.close();
await prisma.$disconnect();
