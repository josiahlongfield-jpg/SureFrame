// Server-copy expiry: the Library shows when each recording's encrypted copy
// is deleted (in the viewer's time zone), "Saved to cloud backup" or "Deleted
// from our servers", and a "Deleting soon" filter (within 7 days, soonest
// first, only what this person may see). The reminders job emails each
// recorder once, ~24 hours ahead, grouped into one email, never with titles,
// and never for cloud-backup workspaces, replies or already-deleted copies.
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
const keptEl = await cloud.waitForSelector(`a[href="/v/${kept.id}"] [data-testid=storage-status]`);
ok("cloud backup: saved to cloud backup", norm(await keptEl.textContent()) === "Saved to cloud backup");

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
ok("subject", m.subject === "2 recordings are deleted from SureFrame in 24 hours", m.subject);
ok("lists each recording once (copies merged), with clients", m.text.includes(`sent to Ana ${stamp}, Ben ${stamp}`) && m.text.split(`/v/${soon1.id}`).length === 2 && m.text.includes(`/v/${soon2.id}`), m.text);
ok("not the 3-day, 10-day, expired or reply videos", ![in3days, in10days, expired, reply, soon1copy].some((v) => m.text.includes(`/v/${v.id}`)));
ok("exact deletion time in UTC", m.text.includes(new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(soon1.purgeAt) + " UTC"));
ok("advises saving to device", m.text.includes("Save to device") && m.text.includes("can no longer be watched from the link") && !m.text.includes("original stays on"));
ok("owner on a paid plan is told about cloud backup", m.text.includes("/settings/billing"));
ok("no titles in any email", !mails.some((x) => (x.text + x.html + x.subject).includes("Secret title")));
ok("staff recorder gets their own email (not the owner)", toStaff.length === 1 && toStaff[0].subject === "A recording is deleted from SureFrame in 24 hours" && toStaff[0].text.includes(`/v/${staffVid.id}`) && !toOwner.some((x) => x.text.includes(staffVid.id)));
ok("staff aren't sent the billing link", toStaff[0] && !toStaff[0].text.includes("/settings/billing") && toStaff[0].text.includes("team owner"));
ok("no email for the cloud backup workspace", !mails.some((x) => x.to === cloudEmail));
const warned = await prisma.video.findMany({ where: { id: { in: [soon1.id, soon1copy.id, soon2.id, staffVid.id, in3days.id, reply.id, keptStale.id] } }, select: { id: true, expiryWarnedAt: true } });
const w = Object.fromEntries(warned.map((v) => [v.id, !!v.expiryWarnedAt]));
ok("warned state recorded", w[soon1.id] && w[soon1copy.id] && w[soon2.id] && w[staffVid.id] && !w[in3days.id] && !w[reply.id] && !w[keptStale.id], JSON.stringify(w));

const mid = outbox().length;
await cron();
await cron("purge");
ok("sent exactly once (both jobs run again)", !outbox().slice(mid).some((x) => [ownerEmail, staffEmail].includes(x.to)));

// A video rescheduled into the window later gets its own email.
await prisma.video.update({ where: { id: in3days.id }, data: { purgeAt: new Date(Date.now() + 12 * H) } });
const mid2 = outbox().length;
await cron();
const late = outbox().slice(mid2).filter((x) => x.to === ownerEmail);
ok("a video newly inside the window is warned separately", late.length === 1 && late[0].subject === "A recording is deleted from SureFrame in 24 hours" && late[0].text.includes(`/v/${in3days.id}`));

await prisma.video.deleteMany({ where: { workspaceId: { in: [workspaceId, cloudWs] } } });
await browser.close();
await prisma.$disconnect();
