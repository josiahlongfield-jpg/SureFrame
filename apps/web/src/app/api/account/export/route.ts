import { exportAccount } from "@/lib/account";
import { currentUser, handle, HttpError } from "@/lib/session";
import { limitByIp } from "@/lib/rateLimit";

/** `?wraps=1`: with the wrapped keys, for the readable copy made in the browser (components/ReadableExport.tsx). */
export const GET = handle(async (req: Request) => {
  await limitByIp("export", 10, 3600);
  // Paused staff can still download their own data; paused teams are left out of it (lib/account.ts).
  const me = await currentUser();
  if (!me) throw new HttpError(401, "Sign in required");
  const { user } = me;
  const data = await exportAccount(user.id, { wraps: new URL(req.url).searchParams.get("wraps") === "1" });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="sureframe-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
