import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import { checkAuthorize, errorRedirect, issueCode } from "@/lib/connector/oauth";
import { LEGAL } from "@/lib/legal";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "Connect Claude", robots: { index: false } };

type Query = Record<string, string | undefined>;
const PARAMS = ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"] as const;

const pick = (q: Query) => Object.fromEntries(PARAMS.filter((k) => typeof q[k] === "string").map((k) => [k, q[k]])) as Query;
const here = (q: Query) => `/oauth/authorize?${new URLSearchParams(pick(q) as Record<string, string>)}`;

/**
 * The sign-in page for the online connector (lib/connector/oauth.ts): the signed-in person allows their own
 * Claude to read their activity in this team, read-only, or cancels. Claude opens it; the answer goes back to
 * Claude's own callback address, shown here.
 */
export default async function Authorize({ searchParams }: { searchParams: Promise<Query> }) {
  const q = pick(await searchParams);
  const checked = await checkAuthorize(q);
  if ("back" in checked) redirect(checked.back);
  if ("page" in checked)
    return (
      <Shell>
        <p className="mt-6 text-muted" data-testid="authorize-invalid">{checked.page}</p>
        {/* Not a dead end (O97): back to where connections are set up. */}
        <Link href="/settings/connections" className="mt-4 inline-block text-sm font-medium text-accent underline" data-testid="authorize-back">
          Go to Settings &gt; Connections
        </Link>
      </Shell>
    );
  const me = await requirePageUser(here(q));
  const request = checked.ok;
  const host = new URL(request.redirectUri).host;
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);

  async function decide(form: FormData) {
    "use server";
    const again = await checkAuthorize(pick(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]))));
    if (!("ok" in again)) redirect("back" in again ? again.back : "/settings/connections");
    const now = await requirePageUser("/settings/connections");
    // The team shown when they chose: if they switched teams in another tab meanwhile, ask again.
    if (form.get("ws") !== now.workspace.id) redirect(here(pick(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])))));
    if (form.get("decision") !== "allow") redirect(errorRedirect(again.ok.redirectUri, again.ok.state, "access_denied", "Cancelled"));
    redirect(await issueCode(again.ok, now.user.id, now.workspace.id));
  }

  return (
    <Shell>
      <h1 className="mt-6 text-xl font-semibold tracking-tight text-ink" data-testid="authorize-heading">
        Let {request.client.name} read your {LEGAL.product} activity?
      </h1>
      <p className="mt-3 text-muted">
        Signed in as <span className="font-medium text-ink">{me.user.email}</span> for <span className="font-medium text-ink">{me.workspace.name}</span>.
      </p>
      <div className="mt-6 grid gap-2 rounded-xl border border-line bg-surface-2 p-4 text-sm text-muted">
        <p className="font-medium text-ink">It will be able to see, for the clients you can see:</p>
        <ul className="grid list-disc gap-1 pl-5">
          <li>client names and who looks after them</li>
          <li>which videos were sent, when, and whether they were opened</li>
          <li>when clients replied and who&rsquo;s waiting for an answer</li>
          <li>to-do due dates and how many are overdue</li>
        </ul>
        <p className="mt-1 font-medium text-ink">It can&rsquo;t:</p>
        <ul className="grid list-disc gap-1 pl-5">
          <li>watch videos or read messages, replies, to-dos, notes or transcripts (they&rsquo;re end-to-end encrypted)</li>
          <li>send, change or delete anything</li>
        </ul>
      </div>
      <p className="mt-4 text-sm text-muted">
        What it reads goes to its provider under your own account with them. You can disconnect it any time in Settings &gt; Connections.
      </p>
      <p className="mt-2 text-xs text-dim" data-testid="authorize-host">
        You&rsquo;ll be sent back to <span className="font-medium text-ink">{host}</span>.
        {local ? " That's an app on this computer (such as Claude Code)." : ""} Only allow it if you started connecting {LEGAL.product} in Claude just now.
      </p>
      <form action={decide} className="mt-6 flex flex-wrap gap-3">
        {Object.entries(q).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input type="hidden" name="ws" value={me.workspace.id} />
        <button
          name="decision"
          value="allow"
          className="rounded-xl bg-primary px-5 py-3 font-semibold text-on-primary shadow-sm hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Allow
        </button>
        <button name="decision" value="cancel" className="rounded-xl border border-line-strong px-5 py-3 font-medium text-ink hover:bg-surface-2">
          Cancel
        </button>
      </form>
    </Shell>
  );
}

/** The same navy frame as the sign-in step before it, so the hand-off from Claude reads as one flow (D9). */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main data-theme="navy" className="fit-screen navy-glow text-ink px-4 py-4 short:py-2">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8 short:p-4">
        <Logo tone="dark" />
        {children}
        <p className="mt-6 border-t border-line pt-4 text-xs text-dim">
          <Link href="/settings/connections" className="font-medium text-accent hover:underline">Settings &gt; Connections</Link> lists every connection, and
          disconnects any.
        </p>
      </div>
    </main>
  );
}
