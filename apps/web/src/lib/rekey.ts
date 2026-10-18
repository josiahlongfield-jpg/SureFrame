import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db, type Workspace } from "@/lib/db";
import { clientLink, newClientToken } from "@/lib/clients";
import { sendMails } from "@/lib/mail";
import { newLinkEmail } from "@/lib/newLinkEmail";
import { brandOf } from "@/lib/branding";
import { HttpError } from "@/lib/session";
import { appUrl } from "@/lib/stripe";
import { clientMailSettings } from "@/lib/reminders";
import { recordReplaced } from "@/lib/replacedLinks";

const Wrap = z.string().min(40).max(200);
const Fp = z.string().min(16).max(64);

/** Everything re-sealed by the remover's browser under new keys (see GET /api/team/rekey). */
export const RekeyBody = z.object({
  from: Fp,
  fingerprint: Fp,
  /** The new team key, wrapped with the old one, for the team's other devices. */
  teamWrap: Wrap,
  clients: z
    .array(
      z.object({
        id: z.string(),
        teamKeyWrap: Wrap,
        /** Active clients get a new key: its fingerprint, the old one's, and the new key wrapped with the old. */
        rotation: z.object({ from: Fp, fingerprint: Fp, wrap: Wrap }).optional(),
      }),
    )
    .max(20000),
  videos: z.array(z.object({ id: z.string(), teamKeyWrap: Wrap, clientKeyWrap: Wrap.nullable() })).max(100000),
  items: z.array(z.object({ id: z.string(), body: z.string().min(20).max(20000) })).max(100000),
});

const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && a.every((x) => new Set(b).has(x));

/**
 * Swap in everything the browser re-sealed under new keys, all at once: new
 * team key, new client keys, a new link for every client (old links stop
 * working), the old keys' chains for devices still holding them. Clients
 * with an email get their new link. `also` runs inside the same transaction.
 */
export async function applyRekey(workspace: Workspace, d: z.infer<typeof RekeyBody>, also?: (tx: Prisma.TransactionClient) => Promise<void>) {
  if (d.from !== workspace.keyFingerprint) throw new HttpError(409, "Your team's keys already changed. Reload the page and try again.");
  const newTokens = new Map<string, string>();
  const emails: { email: string; name: string; token: string; assignedToId: string | null }[] = [];
  await db.$transaction(
    async (tx) => {
      // Lock the workspace row so two resets can't interleave.
      const locked = await tx.$queryRaw<{ keyFingerprint: string | null }[]>`SELECT "keyFingerprint" FROM "Workspace" WHERE id = ${workspace.id} FOR UPDATE`;
      if (locked[0]?.keyFingerprint !== d.from) throw new HttpError(409, "Your team's keys already changed. Reload the page and try again.");
      const [clients, videos, items] = await Promise.all([
        tx.client.findMany({ where: { workspaceId: workspace.id, teamKeyWrap: { not: null } }, select: { id: true, token: true, removedAt: true, pausedAt: true, linkDisabledAt: true, email: true, name: true, assignedToId: true } }),
        tx.video.findMany({ where: { workspaceId: workspace.id, teamKeyWrap: { not: null } }, select: { id: true } }),
        tx.item.findMany({ where: { workspaceId: workspace.id }, select: { id: true } }),
      ]);
      // Anything left out would be unreadable under the new keys.
      if (!sameSet(d.clients.map((c) => c.id), clients.map((c) => c.id)) || !sameSet(d.videos.map((v) => v.id), videos.map((v) => v.id)) || !sameSet(d.items.map((i) => i.id), items.map((i) => i.id))) {
        throw new HttpError(409, "Something changed while the keys were being reset. Try again.");
      }
      const active = new Map(clients.filter((c) => !c.removedAt).map((c) => [c.id, c]));
      for (const c of d.clients) {
        const live = active.get(c.id);
        const token = live ? newClientToken() : undefined;
        await tx.client.update({ where: { id: c.id }, data: { teamKeyWrap: c.teamKeyWrap, token, keyFingerprint: c.rotation?.fingerprint } });
        if (live && c.rotation) await tx.keyRotation.create({ data: { workspaceId: workspace.id, clientId: c.id, fromFingerprint: c.rotation.from, wrap: c.rotation.wrap } });
        if (live) {
          newTokens.set(c.id, token!);
          // A paused client gets their new link when they're restored (the team can copy it then). One whose link
          // support turned off keeps it off through the reset, so isn't emailed a link that wouldn't open.
          const emailed = !!live.email && !live.pausedAt && !live.linkDisabledAt;
          if (emailed) emails.push({ email: live.email!, name: live.name, token: token!, assignedToId: live.assignedToId });
          // So the old link says it was replaced, not that it was mistyped.
          await recordReplaced(tx, c.id, live.token, emailed);
        }
      }
      // Clients from before encryption have no key to replace, but their links still change.
      for (const c of await tx.client.findMany({ where: { workspaceId: workspace.id, removedAt: null, teamKeyWrap: null } })) {
        const token = newClientToken();
        await tx.client.update({ where: { id: c.id }, data: { token } });
        newTokens.set(c.id, token);
        const emailed = !!c.email && !c.pausedAt && !c.linkDisabledAt;
        if (emailed) emails.push({ email: c.email!, name: c.name, token, assignedToId: c.assignedToId });
        await recordReplaced(tx, c.id, c.token, emailed);
      }
      for (const v of d.videos) await tx.video.update({ where: { id: v.id }, data: { teamKeyWrap: v.teamKeyWrap, clientKeyWrap: v.clientKeyWrap } });
      for (const i of d.items) await tx.item.update({ where: { id: i.id }, data: { body: i.body } });
      await tx.keyRotation.create({ data: { workspaceId: workspace.id, fromFingerprint: d.from, wrap: d.teamWrap } });
      await tx.workspace.update({ where: { id: workspace.id }, data: { keyFingerprint: d.fingerprint } });
      // Pending invites carry the old team key.
      await tx.invite.updateMany({ where: { workspaceId: workspace.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.workspace.update({ where: { id: workspace.id }, data: { keyResetNeeded: null } });
      if (also) await also(tx);
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  const brand = brandOf(workspace, appUrl(""));
  const members = await db.membership.findMany({ where: { workspaceId: workspace.id } });
  // Sent in batches, so a business with many clients isn't held up by the per-second sending limit.
  const emailed = await sendMails(
    emails.map((e) => {
      const mail = newLinkEmail({ business: workspace.name, clientName: e.name, link: clientLink(e.token), logoUrl: brand.logoUrl, color: brand.color });
      // Replies reach whoever looks after the client, as with every other client email.
      const { replyTo } = clientMailSettings(workspace, members.find((m) => m.userId === e.assignedToId));
      return { to: e.email, ...mail, fromName: workspace.name, replyTo };
    }),
  ).catch((err) => {
    console.error("new link emails failed", err);
    return 0;
  });
  return { emailed, links: [...newTokens].map(([id, token]) => ({ id, link: clientLink(token) })) };
}
