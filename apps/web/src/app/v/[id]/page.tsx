import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Logo from "@/components/Logo";
import AppHeader from "@/components/AppHeader";
import ClientHeader from "@/components/ClientHeader";
import MadeWith from "@/components/MadeWith";
import { brandOf, brandStyle } from "@/lib/branding";
import WatchView from "@/components/WatchView";
import SureFramePromo from "@/components/SureFramePromo";
import { aiAssistActive, PLANS } from "@/lib/plans";
import { db } from "@/lib/db";
import { clientBlock, clientCookie, clientGate, viewerFor } from "@/lib/access";
import { agreePath, currentUser } from "@/lib/session";
import { clientLink } from "@/lib/clients";
import { publicVideo } from "@/lib/videos";
import { replyDTO, visibleReplies } from "@/lib/replies";
import { canDeleteVideo, clientScopeWhere, effectivePerms } from "@/lib/permissions";
import { zoned } from "@/lib/dates";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ team?: string }> };

async function load(id: string) {
  const video = await db.video.findUnique({ where: { id }, include: { owner: { select: { name: true, email: true } } } });
  if (!video || video.replyToId) return null;
  return { video, viewer: await viewerFor(video) };
}

// Titles and thumbnails are never put in link previews: videos are private.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const found = await load(id);
  return { title: found?.viewer ? found.video.title : "Private video", robots: { index: false } };
}

export default async function Watch({ params, searchParams }: Props) {
  const { id } = await params;
  const found = await load(id);
  if (!found) notFound();
  const { video, viewer } = found;

  // Links in team emails (?team=1) open the team's own view: sign in first, or
  // switch to the video's workspace, rather than falling back to the client
  // view this browser may also have.
  if ((await searchParams).team && viewer?.kind !== "member") {
    const me = await currentUser();
    if (!me) redirect(`/login?next=${encodeURIComponent(`/v/${id}?team=1`)}`);
    if (me.workspace.id !== video.workspaceId && me.user.memberships.some((m) => m.workspaceId === video.workspaceId && !m.pausedAt)) {
      await db.user.update({ where: { id: me.user.id }, data: { activeWorkspaceId: video.workspaceId } });
      redirect(`/v/${id}`);
    }
  }

  if (!viewer) {
    // The team of a suspended workspace (or a suspended login) is told so, not that the video is private.
    const me = await currentUser();
    if (me?.suspended && (me.suspended === "user" || me.workspace.id === video.workspaceId)) redirect("/suspended");
    // Their own team's video, before they've agreed to the current terms (lib/terms.ts).
    if (me && !me.agreed && !me.paused && me.workspace.id === video.workspaceId) redirect(agreePath(`/v/${id}`));
    // The client it was sent to, when support has turned their link off or the business's videos are unavailable.
    const token = video.clientId ? (await cookies()).get(clientCookie(video.workspaceId))?.value : undefined;
    const mine = token ? await db.client.findUnique({ where: { token }, include: { workspace: { select: { ...clientGate, name: true } } } }) : null;
    const block = mine?.id === video.clientId ? clientBlock(mine) : null;
    if (mine && (block === "unavailable" || block === "off")) {
      return (
        <div data-theme="navy" className="grid min-h-screen place-items-center bg-canvas px-4 text-ink">
          <div className="max-w-sm rounded-2xl border border-line bg-surface p-8 text-center" data-testid={block === "off" ? "video-link-off" : "video-unavailable"}>
            <Logo />
            <h1 className="mt-6 text-lg font-semibold text-ink">{block === "off" ? "This link has been turned off" : "Unavailable right now"}</h1>
            <p className="mt-2 text-sm text-muted">
              {block === "off" ? `It no longer opens your videos from ${mine.workspace.name}.` : `Videos from ${mine.workspace.name} are unavailable right now.`}
            </p>
          </div>
        </div>
      );
    }
    return (
      <div data-theme="navy" className="grid min-h-screen place-items-center bg-canvas px-4 text-ink">
        <div className="max-w-sm rounded-2xl border border-line bg-surface p-8 text-center">
          <Logo />
          <h1 className="mt-6 text-lg font-semibold text-ink">This video is private</h1>
          <p className="mt-2 text-sm text-muted">
            Open it from the personal link you were sent, or sign in if it&apos;s yours.
          </p>
          <Link href={`/login?next=/v/${id}`} className="mt-6 inline-block text-sm font-medium text-accent hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const isMember = viewer.kind === "member";
  const access = viewer.kind === "member" ? viewer.access : null;
  const perms = access ? effectivePerms(access) : null;
  const [replies, clients, staff, copies] = await Promise.all([
    db.reply.findMany({ where: { videoId: id, ...visibleReplies }, orderBy: { createdAt: "asc" }, include: { media: true } }),
    // Only the clients this person may see (lib/permissions.ts).
    access ? db.client.findMany({ where: { ...clientScopeWhere(access), removedAt: null, pausedAt: null, linkDisabledAt: null }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    // Quick picks by staff member only help someone who can see everyone's clients.
    access && perms?.seeAllClients ? db.membership.findMany({ where: { workspaceId: video.workspaceId }, include: { user: true }, orderBy: { id: "asc" } }) : Promise.resolve([]),
    // The other clients this recording went to, each with their own conversation.
    access && !video.sourceId ? db.video.findMany({ where: { sourceId: video.id, client: clientScopeWhere(access) }, select: { id: true, clientId: true }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
  ]);
  // Staff can open a video they recorded that went to someone else's client: show who, nothing more.
  // So do removed and paused clients, and those whose link support turned off, who can't open it.
  const recipient = access && video.clientId && !clients.some((c) => c.id === video.clientId)
    ? await db.client.findUnique({ where: { id: video.clientId }, select: { id: true, name: true, removedAt: true, purgeAt: true, pausedAt: true, linkDisabledAt: true } })
    : null;
  const expired = !!video.expiresAt && video.expiresAt < new Date();
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: video.workspaceId } });
  // A removed client's conversations are deleted with them. The recording stays when it was also sent to
  // other clients: this is a copy of it, or an original with copies (lib/clientRemoval.ts).
  const removed = recipient?.removedAt
    ? {
        until: recipient.purgeAt && recipient.purgeAt > new Date() ? zoned(workspace.timezone).longDay(recipient.purgeAt) : null,
        keepsRecording: !!video.sourceId || (await db.video.count({ where: { sourceId: video.id, OR: [{ clientId: null }, { clientId: { not: recipient.id } }] } })) > 0,
        // Without cloud backup the recording can expire before the client is deleted; the page gives its own date.
        recordingFirst: !!video.purgeAt && (!recipient.purgeAt || video.purgeAt <= recipient.purgeAt),
      }
    : undefined;
  // AI summaries add-on. Copies sent to other clients share the original recording's transcript.
  const aiOn = aiAssistActive(workspace);
  const insight = await db.videoInsight.findUnique({ where: { videoId: video.sourceId ?? video.id }, select: { transcript: true, summary: true } });
  // Clients see the business's branding; the team sees the normal app.
  const brand = isMember ? null : brandOf(workspace);
  const memberEmail = viewer.kind === "member" ? (await db.user.findUnique({ where: { id: viewer.userId }, select: { email: true } }))?.email : null;
  // The team sees reactions, and on an original sent to several clients, everyone's views.
  const [reactions, copyViews] = isMember
    ? await Promise.all([
        db.reaction.findMany({ where: { videoId: id }, orderBy: { createdAt: "asc" }, take: 500, select: { emoji: true, timestampMs: true } }),
        video.sourceId ? Promise.resolve(0) : db.video.aggregate({ where: { sourceId: video.id }, _sum: { viewCount: true } }).then((a) => a._sum.viewCount ?? 0),
      ])
    : [undefined, 0];

  return (
    <div data-theme="navy" className="min-h-screen bg-canvas text-ink" style={isMember ? undefined : brandStyle(brand?.color ?? null)}>
      {isMember ? (
        // The team gets the normal app menu, so they can get back to the Library and everything else.
        <AppHeader email={memberEmail ?? ""} plan={PLANS[workspace.plan].name} />
      ) : (
        <ClientHeader brand={brand} width="max-w-6xl" allVideosLink />
      )}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {expired ? (
          <p className="rounded-2xl border border-line bg-surface p-16 text-center text-muted">This link has expired.</p>
        ) : (
          <>
          {!isMember && PLANS[workspace.plan].showsPromo && <SureFramePromo videoId={video.id} />}
          <WatchView
            video={{ ...publicVideo(video), viewCount: video.viewCount + copyViews }}
            ownerName={
              // Clients see "Sam from Business" (never an email); the team sees the name or email.
              isMember ? (video.owner.name ?? video.owner.email.split("@")[0]) : video.owner.name ? `${video.owner.name} from ${workspace.name}` : workspace.name
            }
            canDelete={!!access && canDeleteVideo(access, video)}
            // Only a finished original counts (a refused upload never got a duration).
            freeVideoLimit={isMember && !video.sourceId && !video.replyToId && video.status !== "RECORDING" && video.durationMs !== null ? PLANS[workspace.plan].maxVideos : null}
            viewer={
              viewer.kind === "member"
                ? { kind: "member", workspaceId: video.workspaceId, fingerprint: workspace.keyFingerprint }
                : { kind: "client", clientId: viewer.client.id }
            }
            clients={[
              ...clients.map((c) => ({ id: c.id, name: c.name, link: clientLink(c.token, video.id), teamKeyWrap: c.teamKeyWrap, assignedToId: c.assignedToId, hasLink: !!(c.linkOpenedAt || c.linkSentAt), emailable: !!c.email && !c.remindersOff, emailsOff: !!c.email && c.remindersOff })),
              ...(recipient ? [{ id: recipient.id, name: recipient.name, link: "", teamKeyWrap: null, assignedToId: null, removed, paused: !!recipient.pausedAt, linkOff: !!recipient.linkDisabledAt }] : []),
            ]}
            sendMany={
              viewer.kind === "member" && perms?.sendToMany
                ? {
                    meId: viewer.userId,
                    sourceId: video.sourceId,
                    staff: staff.map((m) => ({ id: m.userId, name: m.user.name ?? m.user.email.split("@")[0] })),
                    copies: copies.filter((c) => c.clientId).map((c) => ({ id: c.id, clientId: c.clientId! })),
                  }
                : undefined
            }
            sentToId={video.clientId}
            ai={aiOn || insight ? { insight, canMake: isMember && aiOn, notice: !isMember } : undefined}
            initialReplies={replies.map((r) => replyDTO(r, video.ownerId))}
            reactions={reactions}
          />
          </>
        )}
      </main>
      {!isMember && <MadeWith />}
    </div>
  );
}
