import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import AppHeader from "@/components/AppHeader";
import { CopyConnectorUrl, DesktopConnectionCode } from "@/components/ConnectorSetup";
import { mcpResource } from "@/lib/connector/oauth";
import { USE_KEEP_DAYS } from "@/lib/connector/grants";
import { zoned } from "@/lib/dates";
import { db } from "@/lib/db";
import { PLANS } from "@/lib/plans";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "Connections" };

const KIND = { online: "Claude (online)", desktop: "Claude Desktop" } as const;
const TOOL_NAMES: Record<string, string> = {
  get_overview: "overview",
  list_clients: "client list",
  get_client_activity: "client activity",
  list_replies_waiting: "replies waiting",
  list_todos: "to-do dates",
  list_videos: "video list",
  get_team_activity: "team activity",
  read_client: "a client's notes and conversations",
  read_todos: "to-dos",
  read_notes: "notes",
  read_conversation: "a conversation",
  search_text: "a search",
};

/**
 * Settings > Connections: connect your own Claude to SureFrame (lib/connector), see what each connection has
 * read and when, and disconnect it. Owners and admins also see, and can disconnect, their staff's connections.
 */
export default async function Connections() {
  const me = await requirePageUser("/settings/connections");
  const manager = me.role !== "MEMBER";
  const when = zoned(me.workspace.timezone);
  const grants = await db.connectorGrant.findMany({
    where: { workspaceId: me.workspace.id, revokedAt: null, ...(manager ? {} : { userId: me.user.id }), OR: [{ kind: "desktop" }, { refreshExpiresAt: { gt: new Date() } }] },
    include: { user: { select: { name: true, email: true } }, uses: { orderBy: { createdAt: "desc" }, take: 5 }, _count: { select: { uses: true } } },
    orderBy: { createdAt: "desc" },
  });
  const mine = grants.filter((g) => g.userId === me.user.id);
  const staff = grants.filter((g) => g.userId !== me.user.id);

  async function disconnect(form: FormData) {
    "use server";
    const now = await requirePageUser("/settings/connections");
    const id = String(form.get("id") ?? "");
    // Your own, or anyone's on your team if you're an owner or admin.
    await db.connectorGrant.updateMany({
      where: { id, workspaceId: now.workspace.id, revokedAt: null, ...(now.role === "MEMBER" ? { userId: now.user.id } : {}) },
      data: { revokedAt: new Date() },
    });
    revalidatePath("/settings/connections");
    redirect("/settings/connections#yours");
  }

  const list = (rows: typeof grants, showWho: boolean) => (
    <ul className="mt-3 grid gap-3">
      {rows.map((g) => (
        <li key={g.id} className="rounded-2xl border border-line bg-surface p-4 text-sm" data-testid="connection-row">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-ink">
                {KIND[g.kind as keyof typeof KIND] ?? g.name}
                {showWho && <span className="font-normal text-muted"> · {g.user.name ?? g.user.email}</span>}
              </p>
              <p className="mt-1 text-muted">
                Connected {when.day(g.createdAt)}
                {g.lastUsedAt ? `, last used ${when.shortDayTime(g.lastUsedAt)}` : ", not used yet"}
              </p>
              {g.uses.length > 0 && (
                <p className="mt-1 text-xs text-dim" data-testid="connection-uses">
                  Recently read: {[...new Set(g.uses.map((u) => TOOL_NAMES[u.tool] ?? u.tool))].join(", ")}
                  {g._count.uses > 0 && ` (${g._count.uses} ${g._count.uses === 1 ? "time" : "times"} in the last ${USE_KEEP_DAYS} days)`}
                </p>
              )}
            </div>
            <form action={disconnect}>
              <input type="hidden" name="id" value={g.id} />
              <button className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover" data-testid="disconnect">
                Disconnect
              </button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <AppHeader email={me.user.email} plan={PLANS[me.workspace.plan].name} />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted">
          <Link href="/settings" className="hover:underline">Settings</Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Connections</h1>
        <p className="mt-1 text-sm font-medium text-accent" data-testid="connections-free">Free bonus on every plan. Uses your own Claude account.</p>
        <p className="mt-2 text-muted">
          Connect your own Claude so it can read your {me.workspace.name} activity and make reports for you. It only reads, and only what you can
          see here. It can&apos;t send, change or delete anything. <Link href="/help/claude" className="font-medium text-ink underline">How it works</Link>
        </p>

        <section className="mt-8 rounded-2xl border border-line bg-surface p-5" data-testid="online-setup">
          <h2 className="text-lg font-semibold text-ink">Claude on the web, phone or computer</h2>
          <p className="mt-1 text-sm text-muted">
            Sees activity: client names, videos sent and opened, who&apos;s waiting for an answer and to-do due dates. Not your messages, notes or to-do
            text, which stay end-to-end encrypted.
          </p>
          <ol className="mt-3 grid list-decimal gap-1 pl-5 text-sm text-ink">
            <li>In Claude, open Settings, then Connectors, and choose Add custom connector.</li>
            <li>Name it SureFrame and paste this address:</li>
          </ol>
          <CopyConnectorUrl url={mcpResource()} />
          <ol start={3} className="mt-3 grid list-decimal gap-1 pl-5 text-sm text-ink">
            <li>Choose Connect, sign in to SureFrame if asked, and choose Allow.</li>
          </ol>
        </section>

        <section className="mt-6 rounded-2xl border border-line bg-surface p-5" data-testid="desktop-setup">
          <h2 className="text-lg font-semibold text-ink">Claude Desktop, with your notes and conversations</h2>
          <p className="mt-1 text-sm text-muted">
            Also reads your to-dos, notes, messages, replies and AI summaries. They&apos;re unlocked on your own computer with your team&apos;s key, so
            SureFrame still can&apos;t read them. Needs the Claude Desktop app on a Mac or Windows computer.
          </p>
          <ol className="mt-3 grid list-decimal gap-1 pl-5 text-sm text-ink">
            <li>
              <a href="/connector/sureframe.mcpb" download className="font-medium underline" data-testid="desktop-download">
                Download SureFrame for Claude Desktop
              </a>{" "}
              and open it. Claude Desktop asks to install it.
            </li>
            <li>Make a connection code below and paste it in when Claude Desktop asks for it.</li>
          </ol>
          <DesktopConnectionCode workspaceId={me.workspace.id} fingerprint={me.workspace.keyFingerprint} />
        </section>

        <section id="yours" className="mt-8">
          <h2 className="text-lg font-semibold text-ink">Your connections</h2>
          {mine.length ? list(mine, false) : <p className="mt-2 text-sm text-muted" data-testid="no-connections">You haven&apos;t connected Claude yet.</p>}
        </section>

        {manager && staff.length > 0 && (
          <section className="mt-8" data-testid="staff-connections">
            <h2 className="text-lg font-semibold text-ink">Your team&apos;s connections</h2>
            <p className="mt-1 text-sm text-muted">Each one reads only what that person can see. Disconnect any you don&apos;t want.</p>
            {list(staff, true)}
          </section>
        )}

        <p className="mt-8 text-xs text-dim">
          What Claude reads goes to Anthropic under your own Claude account, not ours. See{" "}
          <Link href="/legal/privacy#own-ai" className="underline">Privacy</Link>.
        </p>
      </main>
    </>
  );
}
