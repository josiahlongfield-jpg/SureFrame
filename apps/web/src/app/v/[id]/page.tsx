import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ComponentProps, ReactNode } from "react";
import type { Video } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ClientHeader from "@/components/ClientHeader";
import MadeWith from "@/components/MadeWith";
import { brandOf, brandStyle, type Brand } from "@/lib/branding";
import WatchView from "@/components/WatchView";
import CantOpen from "@/components/CantOpen";
import Logo from "@/components/Logo";
import { aiAssistActive, PLANS } from "@/lib/plans";
import { db } from "@/lib/db";
import { clientBlock, clientCookie, clientGate, viewerFor } from "@/lib/access";
import { agreePath, currentUser } from "@/lib/session";
import { reactionsBy } from "@/lib/reactions";
import { clientLink } from "@/lib/clients";
import { publicVideo } from "@/lib/videos";
import { heldRepliesOf, replyDTO, replyViewer, visibleReplies } from "@/lib/replies";
import { accessOf, canDeleteVideo, canSeeVideo, clientScopeWhere, effectivePerms } from "@/lib/permissions";
import { zoned } from "@/lib/dates";
import { formerTeams, senderName } from "@/lib/team";
import { replacedLinks } from "@/lib/replacedLinks";

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
    return <CantOpenVideo video={video} me={me} />;
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
    access && !video.sourceId ? db.video.findMany({ where: { sourceId: video.id, client: clientScopeWhere(access) }, select: { id: true, clientId: true, viewCount: true }, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
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
  const hasThumb = isMember && video.encrypted ? (await db.videoThumb.count({ where: { videoId: video.sourceId ?? video.id } })) > 0 : true;
  const [reactions, copyViews] = isMember
    ? await Promise.all([
        // The client's (older reactions didn't say who left them, and were all theirs in practice).
        db.reaction.findMany({ where: { videoId: id, OR: [{ byClient: true }, { authorUserId: null }] }, orderBy: { createdAt: "asc" }, take: 500, select: { emoji: true, timestampMs: true } }),
        video.sourceId ? Promise.resolve(0) : db.video.aggregate({ where: { sourceId: video.id }, _sum: { viewCount: true } }).then((a) => a._sum.viewCount ?? 0),
      ])
    : [undefined, 0];

  // The reactions this viewer left, highlighted so a second tap takes one back.
  const myReactions = (await db.reaction.findMany({ where: { videoId: id, ...reactionsBy(viewer.kind === "member" ? { kind: "member", userId: viewer.userId } : { kind: "client" }) }, select: { emoji: true } })).map((r) => r.emoji);
  const who = replyViewer(viewer);
  const held = await db.reply.findMany({ where: { videoId: id, ...heldRepliesOf(who) }, orderBy: { createdAt: "asc" }, include: { media: true } });

  return (
    <div data-theme="fresh" className="min-h-screen bg-canvas text-ink" style={isMember ? undefined : brandStyle(brand?.color ?? null)}>
      {isMember ? (
        // The team gets the normal app menu, so they can get back to the Library and everything else.
        <AppHeader email={memberEmail ?? ""} plan={PLANS[workspace.plan].name} />
      ) : (
        <ClientHeader
          brand={brand}
          width="max-w-6xl"
          allVideosLink
          help={viewer.kind === "client" ? { for: [{ clientId: viewer.client.id, business: workspace.name }], page: expired ? "cant-open" : "video", videoId: id } : undefined}
        />
      )}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {expired ? (
          <CantOpen title="This link has expired">
            <p>Ask {workspace.name} to send the video again if you still need it.</p>
          </CantOpen>
        ) : (
          <WatchView
            video={{ ...publicVideo(video), viewCount: video.viewCount + copyViews }}
            // Clients see "Sam from Business" (never an email); the team sees the name or email (lib/team.ts).
            ownerName={senderName(video, workspace.name, isMember ? "team" : "client")}
            canDelete={!!access && canDeleteVideo(access, video)}
            // Only a finished original counts (a refused upload never got a duration).
            freeVideoLimit={isMember && !video.sourceId && !video.replyToId && video.status !== "RECORDING" && video.durationMs !== null ? PLANS[workspace.plan].maxVideos : null}
            viewer={
              viewer.kind === "member"
                ? { kind: "member", workspaceId: video.workspaceId, fingerprint: workspace.keyFingerprint }
                : { kind: "client", clientId: viewer.client.id }
            }
            clients={[
              ...clients.map((c) => ({ id: c.id, name: c.name, link: clientLink(c.token, video.id), teamKeyWrap: c.teamKeyWrap, assignedToId: c.assignedToId, hasLink: !!c.linkOpenedAt, emailable: !!c.email && !c.remindersOff, emailsOff: !!c.email && c.remindersOff })),
              ...(recipient ? [{ id: recipient.id, name: recipient.name, link: "", teamKeyWrap: null, assignedToId: null, removed, paused: !!recipient.pausedAt, linkOff: !!recipient.linkDisabledAt }] : []),
            ]}
            sendMany={
              viewer.kind === "member" && perms?.sendToMany
                ? {
                    meId: viewer.userId,
                    sourceId: video.sourceId,
                    staff: staff.map((m) => ({ id: m.userId, name: m.user.name ?? m.user.email.split("@")[0] })),
                    copies: copies.filter((c) => c.clientId).map((c) => ({ id: c.id, clientId: c.clientId!, opened: c.viewCount > 0 })),
                  }
                : undefined
            }
            sentToId={video.clientId}
            ai={aiOn || insight ? { insight, canMake: isMember && aiOn, notice: !isMember } : undefined}
            initialReplies={replies.map((r) => replyDTO(r, video.ownerId, who))}
            reactions={reactions}
            hasThumb={hasThumb}
            sourceId={video.sourceId}
            business={workspace.name}
            message={video.message}
            myReactions={myReactions}
            initialHeld={held.map((r) => replyDTO(r, video.ownerId, who))}
            // Free plan: the intro, once per device per business, only after the video unlocks.
            promo={!isMember && PLANS[workspace.plan].showsPromo ? { workspaceId: workspace.id } : undefined}
          />
        )}
      </main>
      {!isMember && <MadeWith />}
    </div>
  );
}

/** What brandOf needs from a workspace. */
const brandFields = { id: true, name: true, plan: true, brandColor: true, brandLogoType: true, brandVersion: true } as const;

/** A page around the one "can't open" card, in the business's colours when this device is one of their clients. */
function CantOpenShell({ brand, team = false, help, children }: { brand: Brand | null; team?: boolean; help?: ComponentProps<typeof ClientHeader>["help"]; children: ReactNode }) {
  return (
    <div data-theme="fresh" className="flex min-h-screen flex-col bg-canvas text-ink" style={brandStyle(brand?.color ?? null)}>
      {team ? (
        // Signed in to a team: back to their own Library, not a client's videos.
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6"><Logo href="/library" /></div>
        </header>
      ) : (
        <ClientHeader brand={brand} allVideosLink help={help} />
      )}
      <main className="flex-1 px-4 py-10 sm:px-6">{children}</main>
      <MadeWith />
    </div>
  );
}

/**
 * Why this device can't open the video, in plain words. Clients have no accounts, so signing in is only a
 * small link for the business; a signed-in team member is told what's actually in the way.
 */
async function CantOpenVideo({ video, me }: { video: Video; me: Awaited<ReturnType<typeof currentUser>> }) {
  const path = `/v/${video.id}`;
  // A client of this business on this device whose link has stopped working: they're told who and why.
  const token = video.clientId ? (await cookies()).get(clientCookie(video.workspaceId))?.value : undefined;
  const mine = token ? await db.client.findUnique({ where: { token }, include: { workspace: { select: { ...clientGate, ...brandFields } } } }) : null;
  const block = mine?.id === video.clientId ? clientBlock(mine) : null;
  if (mine && block) {
    const name = mine.workspace.name;
    const [title, text, testId] =
      block === "off"
        ? ["This link has been turned off", `It no longer opens your videos from ${name}.`, "video-link-off"]
        : block === "unavailable"
          ? ["Unavailable right now", `Videos from ${name} are unavailable right now.`, "video-unavailable"]
          : block === "removed"
            ? ["Your access has ended", `${name} has ended your access to your videos from them, so this link no longer opens them. If that's a mistake, contact them.`, "video-removed"]
            : block === "closed"
              ? ["This link no longer opens your videos", `${name} has closed their SureFrame account. If you need anything, contact them directly.`, "video-closed"]
              : ["Your access is paused", `${name} changed its SureFrame plan, so your access is paused. Nothing has been deleted; contact them to have it restored.`, "video-paused"];
    return (
      <CantOpenShell brand={brandOf(mine.workspace)} help={{ for: [{ clientId: mine.id, business: name }], page: "cant-open", videoId: video.id }}>
        <CantOpen title={title} testId={testId}>
          <p>{text}</p>
        </CantOpen>
      </CantOpenShell>
    );
  }

  // This device holds a link the business replaced when it reset its keys (someone left their team).
  const [replaced] = token && !mine ? await replacedLinks([token]) : [];
  if (replaced) {
    return (
      <CantOpenShell brand={null}>
        <CantOpen title="Your personal link was replaced" testId="video-link-replaced">
          <p>
            {replaced.business} replaced your personal link to keep your videos secure, so this device needs the new one.{" "}
            {replaced.emailed ? "We've emailed it to you: open it here and this video opens too." : `Ask ${replaced.business} for your new link.`}
          </p>
        </CantOpen>
      </CantOpenShell>
    );
  }

  if (me) {
    // Signed in to the team: say what's actually in the way rather than "sign in".
    const membership = me.user.memberships.find((m) => m.workspaceId === video.workspaceId);
    const ws = membership?.workspace;
    if (membership && ws && me.workspace.id !== ws.id && !membership.pausedAt) {
      return (
        <CantOpenShell brand={null} team>
          <CantOpen title={`This video is in ${ws.name}`} testId="video-other-workspace" action={<a href={`${path}?team=1`} className="inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">Switch to {ws.name}</a>}>
            <p>You&apos;re working in {me.workspace.name} right now.</p>
          </CantOpen>
        </CantOpenShell>
      );
    }
    if (membership && ws && me.workspace.id === ws.id) {
      const access = accessOf(me);
      const forClient = !!video.clientId && !(await canSeeVideo(access, video));
      return (
        <CantOpenShell brand={null} team>
          <CantOpen title={forClient ? "This video is for a client you don't look after" : "You can't open this video"} testId="video-no-access">
            <p>
              {forClient
                ? "Only the team members who look after that client, and the owner and admins, can open it."
                : membership.pausedAt
                  ? `Your access to ${ws.name} is paused.`
                  : "Your access in this team doesn't include it."}{" "}
              Ask the owner or an admin if you need it.
            </p>
          </CantOpen>
        </CantOpenShell>
      );
    }
    // Taken off the team that owns it: the same plain words as on their other pages (components/RemovedNotice.tsx).
    const former = membership ? null : (await formerTeams(me.user.id)).find((t) => t.id === video.workspaceId);
    if (former) {
      return (
        <CantOpenShell brand={null} team>
          <CantOpen title={`You're no longer on ${former.name}'s team`} testId="video-former-member">
            <p>An owner or admin removed you, so you can&apos;t open that team&apos;s videos or clients any more. If that&apos;s a mistake, ask them for a new invite link.</p>
          </CantOpen>
        </CantOpenShell>
      );
    }
  }

  // Anyone else: a client on a device that hasn't opened their link, a different client, or someone with just the address.
  return (
    <CantOpenShell brand={null}>
      <CantOpen title="This video is private" testId="video-private" signInNext={me ? undefined : path}>
        <p>To watch it, open the personal link you were sent. It unlocks the video on that device.</p>
        <p>An address like this one (ending in /v/{video.id}) only opens on a device that has already used that personal link.</p>
        {me && <p>You&apos;re signed in as {me.user.email}, and this video isn&apos;t in your account.</p>}
      </CantOpen>
    </CantOpenShell>
  );
}
