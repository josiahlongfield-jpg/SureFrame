import { appUrl } from "@/lib/appUrl";
import { db } from "@/lib/db";
import { validUnsubscribe } from "@/lib/reminders";
import { handle } from "@/lib/session";

/**
 * The address in the List-Unsubscribe header of emails to clients (lib/mail.ts). A mail app's own Unsubscribe
 * button posts here (RFC 8058 one-click) and the client's emails are turned off at once, with the same signed
 * link the page uses and no sign-in. Only a POST switches anything: link scanners open addresses with a GET,
 * which goes to the page with the confirm button (app/reminders/off). Emails are never switched on from here.
 */
export const POST = handle(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const c = q.get("c");
  const s = q.get("s");
  if (!c || !s || !validUnsubscribe(c, s)) return new Response("This link isn't valid.", { status: 400 });
  await db.client.updateMany({ where: { id: c }, data: { remindersOff: true } });
  return new Response("Emails turned off.");
});

export function GET(req: Request) {
  return Response.redirect(appUrl(`/reminders/off${new URL(req.url).search}`), 303);
}
