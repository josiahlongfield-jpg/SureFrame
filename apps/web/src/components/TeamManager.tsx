"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { exportKey, generateKey, wrapKey } from "@/lib/e2e/crypto";
import { saveKey, teamKeyName } from "@/lib/e2e/keystore";
import { rekey, type Bundle } from "@/lib/e2e/rekey";
import TeamKeyGate from "./TeamKeyGate";
import { KeyActions, KeyText } from "./RecoveryKey";
import { zoned } from "@/lib/dates";
import { BRAND } from "@/lib/brand";
import { writeClipboard } from "@/lib/clipboard";

/** US$8, US$37.50 */
const money = (n: number) => `US$${Number.isInteger(n) ? n : n.toFixed(2)}`;
import { PERMS, permNames, type Perms } from "./StaffPerms";
import RemoveExtras from "./RemoveExtras";
import PurchaseNotice, { reloadAfterPurchase } from "./PurchaseNotice";
import type { NewLink } from "@/lib/rekey";
import FirstLinkSender from "./FirstLinkSender";
import { markLinkSent } from "./ClientsManager";

/** How a removed person's recordings are shown (lib/team.ts FORMER_MEMBER; that file is server-only). */
const FORMER = "Former team member";

/** A client the team sends their new link to after a key reset: never opened their personal link, or has no email. */
type ToSend = { id: string; name: string; email: string | null; link: string; firstLink: boolean };

type Role = "OWNER" | "ADMIN" | "MEMBER";
type Member = { userId: string; name: string; email: string; role: Role; perms: Perms; paused?: boolean };
type Invite = { id: string; email: string | null; role: Role; expiresAt: string };
type Seats = { members: number; pending: number; used: number; limit: number };

type Props = {
  workspaceId: string;
  fingerprint: string | null;
  role: Role;
  meId: string;
  initialSeats: Seats;
  includedStaff: number;
  extraStaff: number;
  canBuyStaff: boolean;
  staffPrice: number;
  /** How often the subscription bills, so the price is shown per month or per year. */
  per?: "month" | "year";
  initialMembers: Member[];
  initialInvites: Invite[];
  workspaces: { id: string; name: string; active: boolean }[];
  /** For dates shown here: the viewer's own zone when known, else this one (lib/dates.ts). */
  timezone?: string | null;
  /** The business name, for the recovery key file. */
  business?: string;
  /** Someone left on their own and still holds the old keys. */
  keyResetNeeded: string | null;
  /** Studio or Agency: staff can be invited. Other plans see the plans box on the page instead of a form. */
  teamPlan?: boolean;
  /** What a new member can do until it's changed on the Team page (lib/permissions.ts DEFAULT_STAFF_PERMS). */
  defaultPerms: Perms;
};

const ROLE_LABEL: Record<Role, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };

/**
 * Invite links, kept in this browser until the invite is used, cancelled or expires: the server only has a
 * hash of the token, and the key after # never reaches it, so it can't show a link again. The team key they
 * wrap is already kept in this browser (lib/e2e/keystore.ts), so keeping the link here adds nothing new.
 */
const INVITE_LINK = "framecast.invite-link:";
const keptLink = (id: string) => {
  try {
    return localStorage.getItem(INVITE_LINK + id);
  } catch {
    return null;
  }
};
const keepLink = (id: string, url: string | null) => {
  try {
    if (url) localStorage.setItem(INVITE_LINK + id, url);
    else localStorage.removeItem(INVITE_LINK + id);
  } catch {
    /* storage blocked: the link is shown only until the page is left */
  }
};

/**
 * What a key reset left to do (new links to send, the new recovery key), kept in this browser until the
 * owner presses "I've saved it", so a reload or a wander off the page doesn't lose it. Only on a device that
 * already holds the new team key, which everything here is sealed with or derived from.
 */
type ResetState = { name: string | null; removed: boolean; emailed: number; toSend: ToSend[]; recoveryKey: string };
const RESET = "framecast.key-reset:";
const keepReset = (workspaceId: string, state: ResetState | null) => {
  try {
    if (state) localStorage.setItem(RESET + workspaceId, JSON.stringify(state));
    else localStorage.removeItem(RESET + workspaceId);
  } catch {
    /* storage blocked: shown until the page is left */
  }
};

export default function TeamManager(props: Props) {
  return (
    <div className="mt-8 grid gap-6">
      {/* Staff see their team on /team; here they only switch businesses. */}
      {props.role !== "MEMBER" && (
        // Inviting needs the team key on this device: the invite link carries it, wrapped.
        <TeamKeyGate workspaceId={props.workspaceId} fingerprint={props.fingerprint}>
          {(teamKey) => <Manager {...props} teamKey={teamKey} />}
        </TeamKeyGate>
      )}
      {props.workspaces.length > 1 && <Switcher workspaces={props.workspaces} />}
    </div>
  );
}

type Confirm =
  | { kind: "remove"; member: Member; bundle: Bundle }
  | { kind: "buy" };

function Manager({ teamKey, workspaceId, keyResetNeeded, role, meId, initialSeats, includedStaff, extraStaff, canBuyStaff, staffPrice, per = "month", initialMembers, initialInvites, timezone, business = "", teamPlan = true, defaultPerms }: Props & { teamKey?: CryptoKey }) {
  const [members, setMembers] = useState(initialMembers);
  const [invites, setInvites] = useState(initialInvites);
  const [seats, setSeats] = useState(initialSeats);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("MEMBER");
  const [link, setLink] = useState<{ url: string; emailedTo: string | null }>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [buyQty, setBuyQty] = useState(1);
  const [removing, setRemoving] = useState<string>();
  const [reset, setReset] = useState<ResetState>();
  // Invite links made in this browser (see INVITE_LINK), by invite id.
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copiedInvite, setCopiedInvite] = useState<string>();
  useEffect(() => {
    const found: Record<string, string> = {};
    for (const i of initialInvites) {
      const url = keptLink(i.id);
      if (url) found[i.id] = url;
    }
    setLinks(found);
    // Links of invites that were used, cancelled or ran out are forgotten.
    try {
      const live = new Set(initialInvites.map((i) => i.id));
      for (const k of Object.keys(localStorage)) if (k.startsWith(INVITE_LINK) && !live.has(k.slice(INVITE_LINK.length))) localStorage.removeItem(k);
    } catch {}
    // A key reset's to-do list, until its recovery key was saved; only if it's this business's current key.
    void (async () => {
      try {
        const kept = localStorage.getItem(RESET + workspaceId);
        if (!kept || !teamKey) return;
        const state = JSON.parse(kept) as ResetState;
        if (state.recoveryKey === (await exportKey(teamKey))) setReset(state);
        else keepReset(workspaceId, null);
      } catch {}
    })();
  }, [initialInvites, workspaceId, teamKey]);
  const [resetDue, setResetDue] = useState(!!keyResetNeeded);
  const [confirming, setConfirming] = useState<Confirm>();
  const [checking, setChecking] = useState<string>();
  const dates = zoned(timezone);
  const canManage = role !== "MEMBER";
  const full = seats.used >= seats.limit;

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!teamKey) return;
    setBusy(true);
    setError(undefined);
    setLink(undefined);
    // A one-off key wraps the team key. It goes only in the link's #fragment, which never reaches our servers.
    const oneOff = await generateKey();
    const res = await fetch("/api/team/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role: inviteRole, teamKeyWrap: await wrapKey(teamKey, oneOff) }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not create the invite");
    const url = `${data.link}#k=${await exportKey(oneOff)}`;
    setLink({ url, emailedTo: data.emailed ? data.invite.email : null });
    keepLink(data.invite.id, url);
    setLinks((l) => ({ ...l, [data.invite.id]: url }));
    setInvites((list) => [...list, { ...data.invite, expiresAt: String(data.invite.expiresAt) }]);
    setSeats((s) => ({ ...s, pending: s.pending + 1, used: s.used + 1 }));
    setEmail("");
  }

  async function cancel(i: Invite) {
    const res = await fetch(`/api/team/invites/${i.id}`, { method: "DELETE" });
    if (!res.ok) return;
    keepLink(i.id, null);
    setInvites((list) => list.filter((x) => x.id !== i.id));
    setSeats((s) => ({ ...s, pending: s.pending - 1, used: s.used - 1 }));
  }

  /** Asks first, in the page, listing the clients whose links change: the key reset needs everything it re-seals anyway. */
  async function remove(m: Member) {
    setError(undefined);
    setChecking(m.userId);
    try {
      const res = await fetch("/api/team/rekey");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not start the key reset");
      setConfirming({ kind: "remove", member: m, bundle: (await res.json()) as Bundle });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(undefined);
    }
  }

  /** Reset every key on this device, then swap them in on the server (removing `m` if given). */
  async function resetKeys(m?: Member, checked?: Bundle) {
    if (!teamKey) return;
    setError(undefined);
    setConfirming(undefined);
    setRemoving(m?.userId ?? "reset");
    try {
      // The key reset happens here, on this device: new team key, new client keys, everything re-sealed.
      let bundle = checked;
      if (!bundle) {
        const got = await fetch("/api/team/rekey");
        if (!got.ok) throw new Error((await got.json().catch(() => ({}))).error ?? "Could not start the key reset");
        bundle = (await got.json()) as Bundle;
      }
      const { team, newClientKeys, payload } = await rekey(teamKey, bundle);
      const res = await fetch(m ? `/api/team/members/${m.userId}/remove` : "/api/team/rekey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not remove");
      await saveKey(teamKeyName(workspaceId), team);
      const names = new Map(bundle!.clients.map((c) => [c.id, c]));
      // Everyone not emailed their new link, except paused clients and links support turned off (sent once they're back).
      const toSend: ToSend[] = await Promise.all(
        (data.links as NewLink[])
          .filter((l) => !l.emailed && !names.get(l.id)?.held)
          .map(async (l) => {
            const key = newClientKeys.get(l.id);
            return { id: l.id, name: names.get(l.id)?.name ?? "Client", email: names.get(l.id)?.email ?? null, link: key ? `${l.link}#k=${await exportKey(key)}` : l.link, firstLink: !l.opened };
          }),
      );
      const done: ResetState = { name: m?.name ?? keyResetNeeded ?? null, removed: !!m, emailed: data.emailed, toSend, recoveryKey: await exportKey(team) };
      setReset(done);
      keepReset(workspaceId, done);
      setResetDue(false);
      // Pending invites were cancelled with the old keys.
      for (const i of invites) keepLink(i.id, null);
      setInvites([]);
      if (m) {
        setMembers((list) => list.filter((x) => x.userId !== m.userId));
        setSeats((s) => ({ ...s, members: s.members - 1, pending: 0, used: s.members - 1 }));
      } else {
        setSeats((s) => ({ ...s, pending: 0, used: s.members }));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemoving(undefined);
    }
  }

  async function buyStaff() {
    setConfirming(undefined);
    setError(undefined);
    const res = await fetch("/api/billing/staff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ extraStaff: extraStaff + buyQty }) });
    const data = await res.json().catch(() => ({}));
    if (data.url) return void (window.location.href = data.url);
    if (!res.ok) return setError(data.error ?? "Could not add staff logins");
    reloadAfterPurchase(buyQty);
  }

  // The counter says who's on the team; an invite holds a login until it's used or cancelled.
  const free = Math.max(0, seats.limit - seats.used);
  return (
    <>
      {(teamPlan || seats.members > 1 || seats.pending > 0) && (
      <section className="rounded-2xl border border-line bg-surface p-6" data-testid="staff-logins">
        <p className="text-sm font-medium text-dim">Staff logins</p>
        <p className="mt-1 text-3xl font-semibold text-ink">
          {seats.members} <span className="text-lg font-normal text-dim">on the team</span>
        </p>
        <p className="mt-1 text-sm text-muted" data-testid="staff-logins-detail">
          {seats.pending > 0 && `${seats.pending} ${seats.pending === 1 ? "invite" : "invites"} waiting to join, holding ${seats.pending === 1 ? "a login" : "logins"} · `}
          {free} of {seats.limit} {seats.limit === 1 ? "login" : "logins"} free
        </p>
        <p className="mt-1 text-xs text-dim">
          {includedStaff} included with your plan (yours counts as one){extraStaff > 0 && ` + ${extraStaff} extra`}
        </p>
        {canBuyStaff && <PurchaseNotice one="staff login" many="staff logins" where="Invite someone below to use them." />}
        {/* Buying more only comes up once every login is in use; bought ones can be given back any time. */}
        {canBuyStaff && (full || extraStaff > 0) && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-5 text-sm">
            {full && (
              <>
                <span className="text-muted">All logins are in use. Need more?</span>
                <select value={buyQty} onChange={(e) => setBuyQty(Number(e.target.value))} aria-label="Extra staff logins" className="rounded-lg border border-line-strong bg-surface px-2 py-1.5">
                  {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n} {n === 1 ? "login" : "logins"}</option>)}
                </select>
                <button onClick={() => setConfirming({ kind: "buy" })} className="rounded-lg bg-solid px-3 py-1.5 font-medium text-white hover:bg-solid-hover">Add for {money(buyQty * staffPrice)}/{per}</button>
                <span className="w-full sm:hidden" />
              </>
            )}
            <span className="sm:ml-auto">
              <RemoveExtras extra={extraStaff} spare={seats.limit - seats.used} noun={{ one: "staff login", many: "staff logins", holder: "staff or cancel invites" }} endpoint="/api/billing/staff" field="extraStaff" onError={setError} />
            </span>
          </div>
        )}
        {role === "ADMIN" && (
          <p className="mt-5 border-t border-line pt-5 text-sm text-muted" data-testid="admin-limits">
            Only the owner can add staff logins or change the plan. As an admin you can invite staff, assign clients, and remove anyone except the owner and yourself.
          </p>
        )}
      </section>
      )}

      {canManage && teamPlan && (
        <section className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-semibold text-ink">Invite someone</h2>
          <p className="mt-1 text-sm text-dim">
            Members record, send and reply to the clients assigned to them. Admins have full access: they can also invite and remove staff and assign clients. Only the owner can
            add staff logins or change the plan.
          </p>
          <p className="mt-2 text-sm text-dim" data-testid="invite-defaults">
            A new member can {permNames(PERMS.filter((p) => defaultPerms[p.key]).map((p) => p.key)) || "record, send and reply"}
            {PERMS.some((p) => !defaultPerms[p.key]) && `, but not ${permNames(PERMS.filter((p) => !defaultPerms[p.key]).map((p) => p.key), "or")}`}. Once they&apos;ve joined, you
            change their role and what they can do on the <Link href="/team" className="font-medium text-accent hover:underline">Team page</Link>.
          </p>
          {full && (
            <p className="mt-3 text-sm text-warn-fg" data-testid="logins-full">
              All {seats.limit} staff logins are in use.{" "}
              {role !== "OWNER" ? "Ask the owner to add one, or remove someone first." : canBuyStaff ? "Add one above, or remove someone first." : "Remove someone first, or see plans with more logins."}
            </p>
          )}
          <form onSubmit={invite} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <input value={email} onChange={(e) => setEmail(e.target.value)} disabled={full} type="email" placeholder="Their email (optional)" aria-label="Staff email" className="rounded-lg border border-line-strong px-3 py-2 text-sm disabled:opacity-50" />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} disabled={full} aria-label="Role" className="rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm disabled:opacity-50">
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button disabled={busy || full} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">Create invite link</button>
          </form>
          <p className="mt-2 text-xs text-dim">With their email, only they can join, and we email them to expect your link. Either way, you send the link yourself.</p>
          {link && (
            <div className="mt-4 rounded-xl border border-ok-line bg-ok-bg p-4 text-sm" data-testid="invite-created">
              <p className="font-medium text-ok-fg [overflow-wrap:anywhere]">
                {link.emailedTo ? `We've emailed ${link.emailedTo} to say you invited them. Now send them this link yourself.` : "Send this link to them yourself."} It works once and expires in 7 days.
              </p>
              <p className="mt-1 text-xs text-ok-fg" data-testid="invite-kept">
                This browser keeps it under Waiting to join below until it&apos;s used, cancelled or expires. We can&apos;t show it anywhere else, so copy it now if you&apos;ll send it from another device.
              </p>
              <p data-testid="invite-link" className="mt-2 break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs text-ink">{link.url}</p>
              <button
                onClick={async () => { await writeClipboard(link.url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="mt-2 rounded-lg border border-ok-line bg-surface px-3 py-1.5 hover:bg-hover">
                {copied ? "Copied" : "Copy link"}
              </button>
              <p className="mt-2 text-xs text-ok-fg">The end of the link (after #) is the key that unlocks your team&apos;s encrypted videos. It never goes to our servers, so it can&apos;t be in our email: send the link by text, chat or your own email.</p>
            </div>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-danger-fg">{error}</p>}
        </section>
      )}
      {(!canManage || !teamPlan) && error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}

      {resetDue && canManage && (
        <section role="alert" className="rounded-2xl border border-warn-line bg-warn-bg p-6 text-sm text-warn-fg">
          <h2 className="font-semibold">{keyResetNeeded} left the team and still holds its keys</h2>
          <p className="mt-1">
            Reset your team&apos;s keys and every client&apos;s personal link so they can&apos;t open anything through {BRAND.name} again. Clients who have opened their link and have an email get
            the new one automatically; you&apos;ll get the others&apos; new links to send yourself.
          </p>
          <button onClick={() => resetKeys()} disabled={!!removing} className="mt-3 rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
            {removing === "reset" ? "Resetting keys…" : "Reset keys now"}
          </button>
        </section>
      )}
      {reset && <ResetDone {...reset} business={business} onKeySaved={() => keepReset(workspaceId, null)} />}
      {confirming?.kind === "remove" && (
        <RemoveDialog member={confirming.member} bundle={confirming.bundle} onCancel={() => setConfirming(undefined)} onConfirm={() => resetKeys(confirming.member, confirming.bundle)} />
      )}
      {confirming?.kind === "buy" && (
        <Dialog
          title={`Add ${buyQty} extra staff ${buyQty === 1 ? "login" : "logins"}?`}
          confirmLabel={`Add for ${money(buyQty * staffPrice)}/${per}`}
          onCancel={() => setConfirming(undefined)}
          onConfirm={buyStaff}
        >
          <p>{money(buyQty * staffPrice)} a {per}, plus any tax. You&apos;re charged today for the rest of this billing period, then it renews with your plan.</p>
        </Dialog>
      )}

      <section className="rounded-2xl border border-line bg-surface">
        {canManage && members.some((m) => m.role !== "OWNER") && (
          <p className="border-b border-line px-6 py-3 text-sm text-dim" data-testid="perms-elsewhere">
            Each person&apos;s role and what they can do are on the <Link href="/team" className="font-medium text-accent hover:underline">Team page</Link>, beside the clients they look after.
          </p>
        )}
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
              <div>
                <p className="font-medium text-ink">
                  {m.name}{m.userId === meId && " (you)"}
                  {m.paused && (
                    <span className="ml-2 rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn-fg" data-testid="staff-paused-badge" title="Over your plan's staff limit">
                      Paused
                    </span>
                  )}
                </p>
                <p className="text-xs text-dim">{m.email}</p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted" data-testid="member-role">{ROLE_LABEL[m.role]}</span>
                {m.role !== "OWNER" && canManage && m.userId !== meId && (
                  <button onClick={() => remove(m)} disabled={!!removing || !!checking} data-testid="remove-member" className="rounded-lg px-3 py-1.5 text-dim hover:bg-hover hover:text-danger-fg disabled:opacity-50">
                    {removing === m.userId ? "Resetting keys…" : checking === m.userId ? "Checking…" : "Remove"}
                  </button>
                )}
              </div>

            </li>
          ))}
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4" data-testid="pending-invite">
              <div className="min-w-0">
                <p className="break-words font-medium text-muted">{i.email ?? "Invite link"}</p>
                <p className="text-xs text-dim">Waiting to join · {ROLE_LABEL[i.role]} · expires {dates.day(new Date(i.expiresAt))}</p>
                {!links[i.id] && (
                  <p className="mt-1 text-xs text-dim" data-testid="invite-link-elsewhere">
                    Its link was shown once, in the browser that made it. Lost it? Cancel this invite and make a new one.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {links[i.id] && (
                  <button
                    onClick={async () => {
                      await writeClipboard(links[i.id]);
                      setCopiedInvite(i.id);
                      setTimeout(() => setCopiedInvite((c) => (c === i.id ? undefined : c)), 2000);
                    }}
                    data-testid="copy-invite-again"
                    aria-label={`Copy the invite link${i.email ? ` for ${i.email}` : ""}`}
                    className="rounded-lg border border-line-strong px-3 py-1.5 font-medium text-ink hover:bg-hover"
                  >
                    {copiedInvite === i.id ? "Copied" : "Copy invite link"}
                  </button>
                )}
                <button onClick={() => cancel(i)} className="rounded-lg px-3 py-1.5 text-dim hover:bg-hover hover:text-danger-fg">Cancel invite</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function ResetDone({ name, removed, emailed, toSend, recoveryKey, business, onKeySaved }: ResetState & { business: string; onKeySaved: () => void }) {
  const [keySaved, setKeySaved] = useState(false);
  const box = useRef<HTMLElement>(null);
  // The removal was asked for further down the page: bring what to do next into view.
  useEffect(() => box.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }), []);
  // The same ways to send it as on the Clients page, and sending it counts the same way (Link sent, not opened yet).
  const list = (clients: ToSend[], testId: string) => (
    <ul className="mt-2 grid gap-2" data-testid={testId}>
      {clients.map((c) => (
        <li key={c.id} className="rounded-lg bg-surface px-3 py-2 text-ink">
          <p className="mb-1.5 break-words font-medium">{c.name}</p>
          <FirstLinkSender compact name={c.name} email={c.email} business={business} getLink={async () => c.link} onSent={() => void markLinkSent(c.id)} copyLabel="Copy new link" />
        </li>
      ))}
    </ul>
  );
  const noEmail = toSend.filter((c) => !c.firstLink);
  const firstLink = toSend.filter((c) => c.firstLink);
  return (
    <section ref={box} role="status" data-testid="key-reset" className="scroll-mt-6 rounded-2xl border border-ok-line bg-ok-bg p-6 text-sm text-ok-fg">
      <h2 className="font-semibold">{removed ? `${name} was removed and your keys were reset` : "Your keys were reset"}</h2>
      {removed && <p className="mt-1">We&apos;ve emailed them that they&apos;re no longer on your team. If they sign in again, they&apos;re told so there too.</p>}
      <p className="mt-1">
        Every client has a new personal link. Old links no longer work, and say they were replaced.
        {emailed > 0 && ` ${emailed} ${emailed === 1 ? "client who had opened their link was" : "clients who had opened their links were"} emailed the new one, which opens straight away on the device they used.`}
        {" "}Pending invites were cancelled. Your team&apos;s other devices update on their own.
      </p>
      {noEmail.length > 0 && (
        <>
          <p className="mt-4 font-medium">These clients have no email on file, so they can&apos;t open their videos until you send them their new link:</p>
          {list(noEmail, "reset-no-email")}
        </>
      )}
      {firstLink.length > 0 && (
        <>
          <p className="mt-4 font-medium">These clients hadn&apos;t opened their personal link yet, so the one you had for them stopped working too. Send them this new one instead:</p>
          {list(firstLink, "reset-first-link")}
          <p className="mt-1 text-xs">They&apos;re also listed under Not opened a video yet on the Clients page.</p>
        </>
      )}
      {keySaved ? (
        <p className="mt-4 font-medium" data-testid="new-key-saved">Saved. Use your new recovery key from now on. It&apos;s also under Settings &gt; Account, Show recovery key.</p>
      ) : (
        <div className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-4 text-warn-fg" data-testid="new-key-box">
          <p className="font-medium">Save your new recovery key</p>
          <p className="mt-1">
            Your team&apos;s keys changed, so this is your recovery key from now on. Keep it in place of the old one. Anyone else on the team is asked to save it too. This
            box stays here until you press I&apos;ve saved it, and the key is always under Settings &gt; Account, Show recovery key.
          </p>
          <KeyText value={recoveryKey} testId="new-recovery-key" className="mt-2" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <KeyActions value={recoveryKey} business={business} tone="warn" />
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/workspace/key/saved", { method: "POST" }).catch(() => null);
                setKeySaved(true);
                onKeySaved();
              }}
              data-testid="new-key-saved-button"
              className="rounded-lg bg-amber-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              I&apos;ve saved it
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Switcher({ workspaces }: { workspaces: { id: string; name: string; active: boolean }[] }) {
  async function go(id: string) {
    const res = await fetch("/api/team/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: id }) });
    if (res.ok) window.location.assign("/library");
  }
  return (
    <section className="rounded-2xl border border-line bg-surface p-6">
      <h2 className="font-semibold text-ink">Your businesses</h2>
      <p className="mt-1 text-sm text-dim">You&apos;re on more than one business&apos;s team. Switch to work in another.</p>
      <ul className="mt-3 grid gap-2 text-sm">
        {workspaces.map((w) => (
          <li key={w.id} className="flex items-center justify-between">
            <span className="text-ink">{w.name}</span>
            {w.active ? <span className="text-xs text-dim">Current</span> : <button onClick={() => go(w.id)} className="rounded-lg border border-line-strong px-3 py-1.5 hover:bg-hover">Switch</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** An in-page confirmation (not the browser's own box): Escape or Cancel closes it. */
function Dialog({ title, children, confirmLabel, danger, onCancel, onConfirm }: { title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  // Focus goes back to the button that opened it (if it's still there) once it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="dialog" aria-modal="true" aria-labelledby="team-dialog-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl" data-testid="team-dialog">
        <h2 id="team-dialog-title" className="text-lg font-semibold text-ink">{title}</h2>
        <div className="mt-2 grid gap-3 text-sm text-muted">{children}</div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} autoFocus className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-hover">Cancel</button>
          <button type="button" onClick={onConfirm} data-testid="dialog-confirm"
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${danger ? "bg-danger-fg text-white hover:opacity-90" : "bg-solid text-white hover:bg-solid-hover"}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Lists who is affected before anyone is removed: every client's personal link changes. */
function RemoveDialog({ member, bundle, onCancel, onConfirm }: { member: Member; bundle: Bundle; onCancel: () => void; onConfirm: () => void }) {
  const active = bundle.clients.filter((c) => c.active);
  // Who gets their new link how (lib/rekey.ts decides the same way).
  const ready = active.filter((c) => !c.held);
  const emailed = ready.filter((c) => c.hasEmail && c.opened);
  const firstLink = ready.filter((c) => !c.opened);
  const noEmail = ready.filter((c) => c.opened && !c.hasEmail);
  const held = active.filter((c) => c.held);
  const names = (list: { name: string }[]) => (list.length > 12 ? `${list.slice(0, 12).map((c) => c.name).join(", ")} and ${list.length - 12} more` : list.map((c) => c.name).join(", "));
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <Dialog title={`Remove ${member.name}?`} confirmLabel="Remove and reset links" danger onCancel={onCancel} onConfirm={onConfirm}>
      <p>
        They lose access straight away, and we email them that they&apos;re no longer on your team. So they can&apos;t open anything they saw before, your team&apos;s keys are reset and every
        client gets a new personal link. Old links stop working and say they were replaced.
      </p>
      {active.length === 0 ? (
        <p>You have no clients yet, so no links change.</p>
      ) : (
        <>
          {emailed.length > 0 && (
            <div data-testid="remove-emailed">
              <p className="font-medium text-ink">{count(emailed.length, "client gets", "clients get")} their new link by email</p>
              <p>{names(emailed)}</p>
              <p className="mt-1">It opens straight away on the device they used before.</p>
            </div>
          )}
          {firstLink.length > 0 && (
            <div className="rounded-xl border border-warn-line bg-warn-bg p-3 text-warn-fg" data-testid="remove-first-link">
              <p className="font-medium">{count(firstLink.length, "client hasn't", "clients haven't")} opened their personal link yet</p>
              <p>{names(firstLink)}</p>
              <p className="mt-1">A link without its key can&apos;t open on a new device, so they aren&apos;t emailed. Straight after, you&apos;ll get their new links here to send yourself.</p>
            </div>
          )}
          {noEmail.length > 0 && (
            <div className="rounded-xl border border-warn-line bg-warn-bg p-3 text-warn-fg" data-testid="remove-no-email">
              <p className="font-medium">{count(noEmail.length, "client has", "clients have")} no email</p>
              <p>{names(noEmail)}</p>
              <p className="mt-1">Straight after, you&apos;ll get their new links here to copy and send yourself.</p>
            </div>
          )}
          {held.length > 0 && (
            <p data-testid="remove-held">
              {names(held)} {held.length === 1 ? "is" : "are"} paused or {held.length === 1 ? "has their" : "have their"} link turned off, so they get a new link once that&apos;s lifted: copy it from the Clients page then.
            </p>
          )}
        </>
      )}
      <p>Their recordings stay with your business, shown as &ldquo;{FORMER}&rdquo;, and the clients they looked after become unassigned.</p>
    </Dialog>
  );
}
