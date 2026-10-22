import type { Metadata } from "next";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import RecordScreen from "@/components/RecordScreen";
import RecoverUploads from "@/components/RecoverUploads";
import { PLANS } from "@/lib/plans";
import { requirePageUser } from "@/lib/session";
import { db } from "@/lib/db";
import { accessOf, clientScopeWhere, effectivePerms } from "@/lib/permissions";
import { uploadingHint, videosUsed } from "@/lib/videoAllowance";

export const metadata: Metadata = { title: "New recording" };

export default async function RecordPage() {
  const me = await requirePageUser("/record");
  const { user, workspace } = me;
  const access = accessOf(me);
  const noClients = effectivePerms(access).addClients && (await db.client.count({ where: { ...clientScopeWhere(access), removedAt: null } })) === 0;
  const plan = PLANS[workspace.plan];
  // Free: videos in total for the life of the workspace. The server checks again when a recording starts.
  const limit = plan.maxVideos;
  const allowance = limit !== null ? await videosUsed(workspace.id) : null;
  const left = allowance && limit !== null ? Math.max(0, limit - allowance.used) : null;
  // After a first recording, the camera, microphone and quality settings start folded away (D12).
  const recordedBefore = (await db.video.count({ where: { workspaceId: workspace.id, ownerId: user.id, replyToId: null, sourceId: null } })) > 0;
  return (
    <>
      <AppHeader email={user.email} plan={plan.name} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight text-ink">New recording</h1>
        {noClients && (
          <p className="mb-6 max-w-2xl rounded-xl border border-line bg-surface p-3 text-sm text-muted" data-testid="no-clients-note">
            {me.role === "MEMBER" ? (
              <>
                No clients are assigned to you yet. Once the owner or an admin assigns some, or you add your own, you can send this video the moment it&apos;s done.{" "}
                <Link href="/clients" className="font-medium text-accent hover:underline">Open Clients</Link>
              </>
            ) : (
              <>
                You haven&apos;t added any clients yet. You can add one when this video is done, or{" "}
                <Link href="/clients" className="font-medium text-accent hover:underline">add your clients first</Link>.{" "}
                <span className="font-medium text-ink">A new client&apos;s first video goes from your own email or texts:</span> the Send box gives you the buttons, and
                they just open it and watch.
              </>
            )}
          </p>
        )}
        {allowance && left === 0 ? (
          <>
            {/* The recorder isn't shown, so recordings left in this browser finish here (the header leaves this page to the recorder). */}
            <RecoverUploads always />
            <div className="mt-4 max-w-xl rounded-2xl border border-line bg-surface p-6" data-testid="free-limit-reached">
              <h2 className="font-semibold text-ink">You&apos;ve used all {limit} free videos</h2>
              <p className="mt-2 text-sm text-muted">
                {allowance.oldRule
                  ? `The Free plan allows ${limit} videos. Delete one or upgrade to record more.`
                  : `The Free plan includes ${limit} videos in total, not per month, and deleted videos still count. Upgrade to record more.`}{" "}
                You can still watch your videos, send them to more clients and reply to your clients.
              </p>
              {allowance.uploading > 0 && !allowance.oldRule && <p className="mt-3 text-sm text-muted">{uploadingHint(allowance.uploading)}</p>}
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/pricing" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">See plans</Link>
                <Link href="/library" className="rounded-xl border border-line-strong px-4 py-2 text-sm font-medium text-muted hover:bg-hover">Go to your library</Link>
              </div>
            </div>
          </>
        ) : (
          <RecordScreen
            workspaceId={workspace.id}
            fingerprint={workspace.keyFingerprint}
            maxResolution={plan.maxResolution}
            maxDurationMin={plan.maxDurationMin}
            freeVideos={left !== null && limit !== null ? { left, limit } : null}
            recordedBefore={recordedBefore}
          />
        )}
      </main>
    </>
  );
}
