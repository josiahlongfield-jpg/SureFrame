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
import { hashToken } from "@/lib/team";

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

/** A client's new link after a reset: emailed to them, or for the team to send (no email, or never opened the old one). */
export type NewLink = { id: string; link: string; emailed: boolean; opened: boolean };

/**
 * Swap in everything the browser re-sealed under new keys, all at once: new
 * team key, new client keys, a new link for every client (old links stop
 * working, and say they were replaced), the old keys' chains for devices
 * still holding them. Clients who opened their old link and have an email get
 * the new one: it opens on the device they used. Those who never opened theirs
 * have no device to upgrade, so they're back on the team's "send their first
 * link" list rather than emailed a link that can't open. `also` runs inside
 * the same transaction.
 */
export async function applyRekey(workspace: Workspace, d: z.infer<typeof RekeyBody>, also?: (tx: Prisma.TransactionClient) => Promise<void>) {
  if (d.from !== workspace.keyFingerprint) throw new HttpError(409, "Your team's keys already changed. Reload the page and try again.");
  const newTokens = new Map<string, { token: string; emailed: boolean; opened: boolean }>();
  const emails: { email: string; name: string; token: string; assignedToId: string | null }[] = [];
  await db.$transaction(
    async (tx) => {
      // Lock the workspace row so two resets can't interleave.
      const locked = await tx.$queryRaw<{ keyFingerprint: string | null }[]>`SELECT "keyFingerprint" FROM "Workspace" WHERE id = ${workspace.id} FOR UPDATE`;
      if (locked[0]?.keyFingerprint !== d.from) throw new HttpError(409, "Your team's keys already changed. Reload the page and try again.");
      const [clients, videos, items] = await Promise.all([
        tx.client.findMany({ where: { workspaceId: workspace.id, teamKeyWrap: { not: null } }, select: { id: true, token: true, removedAt: true, pausedAt: true, linkDisabledAt: true, linkOpenedAt: true, email: true, name: true, assignedToId: true } }),
        tx.video.findMany({ where: { workspaceId: workspace.id, teamKeyWrap: { not: null } }, select: { id: true } }),
        tx.item.findMany({ where: { workspaceId: workspace.id }, select: { id: true } }),
      ]);
      // Anything left out would be unreadable under the new keys.
      if (!sameSet(d.clients.map((c) => c.id), clients.map((c) => c.id)) || !sameSet(d.videos.map((v) => v.id), videos.map((v) => v.id)) || !sameSet(d.items.map((i) => i.id), items.map((i) => i.id))) {
        throw new HttpError(409, "Something changed while the keys were being reset. Try again.");
      }
      const active = new Map(clients.filter((c) => !c.removedAt).map((c) => [c.id, c]));
      /** A live client's new link: who's emailed it, and the old one remembered as replaced. */
      const relink = async (c: { id: string; token: string; email: string | null; name: string; assignedToId: string | null; pausedAt: Date | null; linkDisabledAt: Date | null; linkOpenedAt: Date | null }, token: string) => {
        // A paused client gets their new link when they're restored (the team can copy it then). One whose link
        // support turned off keeps it off through the reset, so isn't emailed a link that wouldn't open. One who
        // never opened their old link has no device that could open a link without its key.
        const emailed = !!c.email && !c.pausedAt && !c.linkDisabledAt && !!c.linkOpenedAt;
        if (emailed) emails.push({ email: c.email!, name: c.name, token, assignedToId: c.assignedToId });
        newTokens.set(c.id, { token, emailed, opened: !!c.linkOpenedAt });
        await tx.replacedClientLink.create({ data: { tokenHash: hashToken(c.token), clientId: c.id, emailed } });
      };
      for (const c of d.clients) {
        const live = active.get(c.id);
        const token = live ? newClientToken() : undefined;
        // The first link the team copied for someone who never opened it is dead now: they need the new one sent.
        await tx.client.update({ where: { id: c.id }, data: { teamKeyWrap: c.teamKeyWrap, token, keyFingerprint: c.rotation?.fingerprint, ...(live && !live.linkOpenedAt ? { linkSentAt: null } : {}) } });
        if (live && c.rotation) await tx.keyRotation.create({ data: { workspaceId: workspace.id, clientId: c.id, fromFingerprint: c.rotation.from, wrap: c.rotation.wrap } });
        if (live) await relink(live, token!);
      }
      // Clients from before encryption have no key to replace, but their links still change.
      for (const c of await tx.client.findMany({ where: { workspaceId: workspace.id, removedAt: null, teamKeyWrap: null } })) {
        const token = newClientToken();
        await tx.client.update({ where: { id: c.id }, data: { token, ...(!c.linkOpenedAt ? { linkSentAt: null } : {}) } });
        await relink(c, token);
      }
      for (const v of d.videos) await tx.video.update({ where: { id: v.id }, data: { teamKeyWrap: v.teamKeyWrap, clientKeyWrap: v.clientKeyWrap } });
      for (const i of d.items) await tx.item.update({ where: { id: i.id }, data: { body: i.body } });
      await tx.keyRotation.create({ data: { workspaceId: workspace.id, fromFingerprint: d.from, wrap: d.teamWrap } });
      await tx.workspace.update({ where: { id: workspace.id }, data: { keyFingerprint: d.fingerprint } });
      // Pending invites carry the old team key.
      await tx.invite.updateMany({ where: { workspaceId: workspace.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.workspace.update({ where: { id: workspace.id }, data: { keyResetNeeded: null } });
      // The recovery key changed: everyone on the team is asked to save the new one (components/RecoveryKey.tsx).
      await tx.membership.updateMany({ where: { workspaceId: workspace.id }, data: { recoveryKeySavedAt: null } });
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
  const links: NewLink[] = [...newTokens].map(([id, t]) => ({ id, link: clientLink(t.token), emailed: t.emailed, opened: t.opened }));
  return { emailed, links };
}
