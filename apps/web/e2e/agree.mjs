// Agreeing to the Terms of Service and Privacy Policy (src/lib/terms.ts) for suites that test something else.
// Every new login is sent to /agree until it agrees, so suites call agreed(email) before signing someone in:
// it makes the login the way the dev login would (if it's new) and records an agreement to the current
// versions, so signing in goes straight to the page asked for. e2e/agree-gate.mjs tests the screen itself.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const legal = readFileSync(new URL("../src/lib/legal.ts", import.meta.url), "utf8");
/** The versions the app asks people to agree to (LEGAL in src/lib/legal.ts). */
export const TERMS_VERSION = legal.match(/termsVersion: "([^"]+)"/)?.[1];
export const PRIVACY_VERSION = legal.match(/privacyVersion: "([^"]+)"/)?.[1];

let db;
/** Records that `email` agreed to the current versions (creating the login first if needed). Returns the user. */
export async function agreed(email, { name } = {}) {
  db ??= new PrismaClient();
  const e = String(email).trim().toLowerCase();
  try {
    const user = await db.user.upsert({ where: { email: e }, update: {}, create: { email: e, name: name === undefined ? e.split("@")[0] : name, onboardedAt: new Date() } });
    const latest = await db.termsAcceptance.findFirst({ where: { userId: user.id }, orderBy: { acceptedAt: "desc" } });
    if (latest?.termsVersion !== TERMS_VERSION || latest?.privacyVersion !== PRIVACY_VERSION) {
      await db.termsAcceptance.create({
        data: { userId: user.id, email: e, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, method: "signup", ip: "127.0.0.1", userAgent: "e2e" },
      });
    }
    return user;
  } finally {
    // Not left connected, so a suite that doesn't exit explicitly still ends.
    await db.$disconnect();
  }
}

/** On /agree: ticks the box, presses Agree and waits to be sent on. Does nothing on any other page. */
export async function passAgree(page) {
  if (new URL(page.url()).pathname !== "/agree") return false;
  await page.check("[data-testid=agree-checkbox]");
  await page.click("[data-testid=agree-submit]");
  await page.waitForURL((u) => u.pathname !== "/agree", { timeout: 30000 });
  return true;
}
