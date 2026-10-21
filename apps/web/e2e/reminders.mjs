// Repeating to-dos and email reminders. The business sets up its reminder
// settings, gives a client a weekly to-do with several reminders, and the
// reminder job sends emails (to .data/outbox without an email provider).
// The client ticks it off and the next week's to-do appears; the client
// turns reminders off from the email link. Emails never contain the
// encrypted to-do text.
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { agreed } from "./agree.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret";
const shots = process.argv[2] ?? "/tmp";
const TZ = "Australia/Sydney";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const sql = (q) => execSync(`su postgres -c "psql -d ${process.env.PGDATABASE ?? "framecast"} -tAc \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra ? ` (${extra})` : ""}`);
  if (!cond) process.exitCode = 1;
};
const outbox = () => {
  try {
    return readdirSync(".data/outbox").sort().map((f) => JSON.parse(readFileSync(`.data/outbox/${f}`, "utf8")));
  } catch {
    return [];
  }
};
// The cron job also sends other tests' digests and expiry warnings, so only
// look at this test's own recipients.
const mailTo = (to) => outbox().filter((m) => m.to === to);
const cron = async (secret = CRON) => {
  const r = await fetch(`${BASE}/api/cron/reminders`, { headers: secret ? { Authorization: `Bearer ${secret}` } : {} });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
};
rmSync(".data/outbox", { recursive: true, force: true });

const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], viewport: { width: 1360, height: 1000 }, timezoneId: TZ });
const pro = await ctx.newPage();
pro.on("console", (m) => m.type() === "error" && console.log("business console:", m.text()));
await pro.goto(BASE + "/settings/reminders");
const loginEmail = `trainer${Date.now()}@peak.com`;
await agreed(loginEmail);
await pro.fill('input[name="email"]', loginEmail);
await pro.click("text=Continue");
await pro.waitForURL("**/todos?tab=reminders");

// 1. Settings, with a live preview of the email
await pro.waitForFunction((tz) => document.querySelector('select[aria-label="Time zone"]')?.value === tz, TZ, { timeout: 5000 }).catch(() => {});
ok("time zone picked up from the browser", (await pro.inputValue('select[aria-label="Time zone"]')) === TZ);
// The list can be searched, one match is picked, and one button goes back to the device's zone.
await pro.fill("[data-testid=tz-search]", "Reykjavik");
ok("searching a city picks its time zone", (await pro.inputValue('select[aria-label="Time zone"]')) === "Atlantic/Reykjavik" && /GMT/.test(await pro.textContent('select[aria-label="Time zone"] option:checked')));
await pro.click("[data-testid=tz-device]");
ok("Use my device's time zone goes back to it", (await pro.inputValue('select[aria-label="Time zone"]')) === TZ && (await pro.locator("[data-testid=tz-is-device]").count()) === 1);
await pro.fill("[data-testid=tz-search]", "");
// The business name lives in Settings > Branding (any plan); Reminders shows it and links there.
ok("Reminders links to Branding for the business name", (await pro.getAttribute("[data-testid=reminders-business] a", "href")) === "/settings/branding");
await pro.goto(BASE + "/settings/branding");
await pro.fill('[data-testid=business-name-form] input[aria-label="Business name"]', "Peak Fitness");
await pro.click("text=Save name");
await pro.waitForSelector("role=status >> text=Saved");
await pro.goto(BASE + "/settings/reminders");
await pro.waitForSelector("[data-testid=reminders-business] >> text=Peak Fitness");
await pro.fill('input[aria-label="Reply-to email"]', "coach@peak.com");
await pro.fill('textarea[aria-label="Personal message"]', "Reply here if you need to reschedule.");
await pro.click("role=group[name='Reminders'] >> text=1 week before");
ok("preview shows business name", (await pro.textContent("[data-testid=preview-subject]")).includes("Reminder from Peak Fitness"));
ok("preview: from the business via SureFrame, as the real email", (await pro.textContent("[data-testid=preview-from]")).trim() === "From: Peak Fitness via SureFrame");
ok("preview shows personal message", (await pro.textContent("[data-testid=preview-body]")).includes("Reply here if you need to reschedule."));
await pro.click("text=Save changes");
await pro.waitForSelector("role=status >> text=Saved");
ok("settings saved", sql(`select name || '|' || timezone || '|' || "reminderReplyTo" from "Workspace" w join "Membership" m on m."workspaceId"=w.id order by w."createdAt" desc limit 1`) === `Peak Fitness|${TZ}|coach@peak.com`);
await pro.screenshot({ path: `${shots}/reminder-settings.png`, fullPage: true });

// 2. A client with an email
await pro.goto(BASE + "/clients");
await pro.click("text=I've saved it");
await pro.fill('input[aria-label="Client name"]', "Riley Client");
await pro.fill('input[aria-label="Client email"]', "riley@example.com");
await pro.click("button:has-text('Add client')");
await pro.click("a[href^='/clients/']:has-text('Riley Client')");
await pro.waitForURL("**/clients/**");
const clientId = pro.url().split("/clients/")[1];

// 3. A weekly to-do, due on a Sunday at least 8 days away, at 9am
const d = new Date();
d.setDate(d.getDate() + 8 + ((7 - ((d.getDay() + 8) % 7)) % 7));
const pad = (n) => String(n).padStart(2, "0");
const dueLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
await pro.fill('textarea[aria-label="New to-do"]', "Record your weekly check-in");
await pro.check("text=Share with Riley");
await pro.fill('input[aria-label="Due date"]', dueLocal);
await pro.selectOption('select[aria-label="Repeat"]', { label: "Every week on Sunday" });
const pressed = await pro.$$eval("role=group[name='Reminders'] >> button[aria-pressed=true]", (b) => b.map((x) => x.textContent));
ok("business defaults pre-selected", pressed.join() === "1 week before,1 day before", pressed.join());
await pro.click("role=group[name='Reminders'] >> text=On the day");
await pro.click("text=+ Custom");
await pro.fill('input[aria-label="Reminder amount"]', "2");
await pro.selectOption('select[aria-label="Reminder unit"]', "hour");
await pro.click("text=Add reminder");
ok("Email Riley ticked by default", await pro.isChecked("text=Email Riley"));
await pro.screenshot({ path: `${shots}/reminder-form.png`, fullPage: true });
await pro.click("form >> button:has-text('Add')");
await pro.waitForSelector("li:has-text('Record your weekly check-in')");
const rowText = await pro.textContent("li:has-text('Record your weekly check-in')");
ok("row shows the repeat", rowText.includes("Every week on Sun"), rowText);
ok("row shows reminders and who gets them", rowText.includes("1 week before, 1 day before, On the day at 8am, 2 hours before") && rowText.includes("· Riley"), rowText);
const itemId = sql(`select id from "Item" where "clientId"='${clientId}'`);
const times = sql(`select string_agg(to_char(("sendAt" at time zone 'UTC') at time zone '${TZ}', 'Dy HH24:MI'), ',' order by "sendAt") from "Reminder" where "itemId"='${itemId}'`);
ok("4 reminders scheduled at the right local times", times === "Sun 09:00,Sat 09:00,Sun 07:00,Sun 08:00", times);

// 4. The reminder job sends one that's due
sql(`update "Reminder" set "sendAt" = now() - interval '1 minute' where id = (select id from "Reminder" where "itemId"='${itemId}' order by "sendAt" limit 1)`);
ok("reminder job needs the secret", (await cron("")).status === 401);
const run1 = await cron();
ok("reminder job sent 1", run1.body?.sent === 1, JSON.stringify(run1.body));
const [mail] = mailTo("riley@example.com");
ok("email went to the client", mail?.to === "riley@example.com");
ok("email from the business, reply-to set", mail?.from.startsWith("Peak Fitness via SureFrame <") && mail?.replyTo === "coach@peak.com");
ok("email has the personal message and opt-out link", mail?.text.includes("Reply here if you need to reschedule.") && mail?.text.includes("/reminders/off?c="));
ok("email never contains the to-do text", !JSON.stringify(mail).includes("weekly check-in"));
console.log("   subject:", mail?.subject);
ok("running again sends nothing new", (await cron()).body?.sent === 0);

// 5. Client ticks it off; next week's appears
await pro.click("text=Copy personal link");
await pro.waitForSelector("text=/^(Link copied|Copied)$/", { timeout: 10000 }).catch(() => {});
const personal = await pro.evaluate(() => navigator.clipboard.readText());
const phoneCtx = await browser.newContext({ ...devices["Pixel 7"], timezoneId: TZ });
const phone = await phoneCtx.newPage();
await phone.goto(personal);
await phone.waitForSelector("text=Record your weekly check-in", { timeout: 15000 });
ok("client sees the repeat", await phone.isVisible("text=Every week on Sun"));
await phone.click('input[aria-label^="Mark \\"Record your weekly check-in\\""]');
await phone.waitForSelector("text=Done (1)");
await phone.waitForSelector("li:has-text('Record your weekly check-in') >> input:not(:checked)");
const nextDue = sql(`select to_char(("dueAt" at time zone 'UTC') at time zone '${TZ}', 'Dy YYYY-MM-DD HH24:MI') from "Item" where "seriesId"='${itemId}'`);
const expected = new Date(d.getTime() + 7 * 86400000);
ok("next week's to-do created", nextDue === `Sun ${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())} 09:00`, nextDue);
ok("old to-do's pending reminders cancelled", sql(`select count(*) from "Reminder" where "itemId"='${itemId}' and "sentAt" is null`) === "0");
ok("new to-do has its own reminders", sql(`select count(*) from "Reminder" r join "Item" i on i.id=r."itemId" where i."seriesId"='${itemId}'`) === "4");
await phone.screenshot({ path: `${shots}/reminder-client.png`, fullPage: true });

// 6. Client turns reminders off from the email link
await phone.goto(mail.text.match(/Stop emails from [^:]+: (\S+)/)[1]);
await phone.click("button:has-text('Stop emails')");
await phone.waitForSelector("text=Emails turned off");
ok("client opted out", sql(`select "remindersOff" from "Client" where id='${clientId}'`) === "t");
sql(`update "Reminder" set "sendAt" = now() - interval '1 minute' where id = (select r.id from "Reminder" r join "Item" i on i.id=r."itemId" where i."seriesId"='${itemId}' order by "sendAt" limit 1)`);
const run2 = await cron();
ok("no email after opting out", run2.body?.sent === 0 && run2.body?.skipped === 1 && mailTo("riley@example.com").length === 1, JSON.stringify(run2.body));
await pro.reload();
await pro.waitForSelector("text=Riley turned reminder emails off");
ok("business sees the opt-out", true);

// 7. Edit a to-do's reminders, and remind the business itself
await pro.click("li:has-text('Record your weekly check-in') >> nth=0 >> button:has-text('Edit')");
// The add form above shows reminders too (greyed until it has a date), so stay inside the item being edited.
await pro.click("li >> role=group[name='Reminders'] >> text=1 week before");
await pro.check("li >> text=Email me");
await pro.click("button:has-text('Save')");
await pro.waitForSelector("text=/1 day before, On the day at 8am, 2 hours before · you/");
ok("edit saved and reminders rescheduled", sql(`select count(*) from "Reminder" r join "Item" i on i.id=r."itemId" where i."seriesId"='${itemId}' and r."sentAt" is null and r."to"='TEAM'`) === "3");

sql(`update "Reminder" set "sendAt" = now() - interval '1 minute' where id = (select r.id from "Reminder" r join "Item" i on i.id=r."itemId" where i."seriesId"='${itemId}' and r."to"='TEAM' and r."sentAt" is null order by "sendAt" limit 1)`);
const runTeam = await cron();
const teamMail = outbox().filter((m) => String(m.to).startsWith("trainer")).at(-1);
ok("business gets its own reminder", runTeam.body?.sent === 1 && teamMail?.to.startsWith("trainer") && teamMail.subject.startsWith("Riley Client: a to-do is due"), teamMail?.subject);

// 8. A missed repeating to-do still rolls forward
sql(`update "Item" set "dueAt" = now() - interval '2 hours' where "seriesId"='${itemId}'`);
const run3 = await cron();
ok("missed repeat rolls on to the next one", run3.body?.spawned === 1, JSON.stringify(run3.body));

await browser.close();
