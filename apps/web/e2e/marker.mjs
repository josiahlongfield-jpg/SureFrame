// The signed activity cookie (sf_active) as the server makes it (src/lib/activityMark.ts), for suites that need one
// from another time, such as "9 hours ago". Signed with the test server's own AUTH_SECRET, read from the
// environment or from apps/web/.env the way the server does. A bare time no longer works: see session-timeout.mjs.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/** The test server's AUTH_SECRET (reminders.mjs signs its own stop-emails links and opt-out markers with it too). */
export function secret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  try {
    const line = readFileSync(new URL("../.env", import.meta.url), "utf8").match(/^AUTH_SECRET=(.*)$/m)?.[1].trim() ?? "";
    return line.replace(/^(["'])(.*)\1$/, "$2") || "dev";
  } catch {
    return "dev";
  }
}

/** The sf_active value for `userId`, as if their last request was at `at` (milliseconds). */
export function activityMark(userId, at = Date.now()) {
  const sig = createHmac("sha256", secret()).update(`sureframe-active:${at}:${userId}`).digest("base64url");
  return `${at}.${sig}`;
}
