import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { KEEP_PARAM } from "@/lib/activity";
import { safeNext } from "@/lib/secrets";
import { callbackTarget } from "@/lib/signInLink";

export const { POST } = handlers;

/**
 * An expired or already-used email link lands on the sign-in page (pages.error in src/auth.ts) with only
 * ?error=Verification, so the new link asked for there used to open the library, not the plan, video or page the old
 * one was going to. The old link's own destination is added as `next`: a path on this site only (callbackTarget
 * keeps just the path, and the sign-in page checks it again with safeNext). Every other answer passes through
 * untouched, and so does this one if anything here goes wrong.
 */
export async function GET(req: NextRequest) {
  const res = await handlers.GET(req);
  try {
    const to = res.headers.get("location");
    if (!to || !req.nextUrl.pathname.endsWith("/callback/email")) return res;
    const url = new URL(to, req.nextUrl.origin);
    if (url.pathname !== "/login" || url.searchParams.get("error") !== "Verification" || url.searchParams.has("next")) return res;
    const target = callbackTarget(req.nextUrl.toString());
    if (!target) return res;
    // The plain address: "keep me signed in" is chosen again with the new link (lib/activity.ts).
    const plain = new URL(target, "http://x");
    plain.searchParams.delete(KEEP_PARAM);
    const next = safeNext(plain.pathname + plain.search, "");
    if (!next) return res;
    url.searchParams.set("next", next);
    const headers = new Headers(res.headers);
    headers.set("location", url.toString());
    return new Response(null, { status: res.status, headers });
  } catch {
    return res;
  }
}
