"use client";

import { useEffect, useState, type ReactNode } from "react";
import { exportKey, generateKey, wrapKey } from "@/lib/e2e/crypto";
import { saveKey, teamKeyName } from "@/lib/e2e/keystore";
import { rekey, type Bundle } from "@/lib/e2e/rekey";
import TeamKeyGate from "./TeamKeyGate";
import { KeyActions, KeyText } from "./RecoveryKey";
import { zoned } from "@/lib/dates";
import { BRAND } from "@/lib/brand";

/** US$8, US$37.50 */
const money = (n: number) => `US$${Number.isInteger(n) ? n : n.toFixed(2)}`;
import { PermChecks, savePerm, type Perms } from "./StaffPerms";
import RemoveExtras from "./RemoveExtras";
import PurchaseNotice, { reloadAfterPurchase } from "./PurchaseNotice";

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
};

const ROLE_LABEL: Record<Role, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };

export default function TeamManager(props: Props) {
  return (
    <div className="mt-8 grid gap-6">
      {props.role !== "MEMBER" ? (
        // Inviting needs the team key on this device: the invite link carries it, wrapped.
        <TeamKeyGate workspaceId={props.workspaceId} fingerprint={props.fingerprint}>
          {(teamKey) => <Manager {...props} teamKey={teamKey} />}
        </TeamKeyGate>
      ) : (
        <Manager {...props} />
      )}
      {props.workspaces.length > 1 && <Switcher workspaces={props.workspaces} />}
    </div>
  );
}

type Confirm =
  | { kind: "remove"; member: Member; bundle: Bundle }
  | { kind: "buy" };

function Manager({ teamKey, workspaceId, keyResetNeeded, role, meId, initialSeats, includedStaff, extraStaff, canBuyStaff, staffPrice, per = "month", initialMembers, initialInvites, timezone, business = "" }: Props & { teamKey?: CryptoKey }) {
  const [members, setMembers] = useState(initialMembers);
  const [invites, setInvites] = useState(initialInvites);
  const [seats, setSeats] = useState(initialSeats);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("MEMBER");
  const [link, setLink] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [buyQty, setBuyQty] = useState(1);
  const [removing, setRemoving] = useState<string>();
  const [reset, setReset] = useState<{ name: string | null; removed: boolean; emailed: number; toSend: { id: string; name: string; link: string }[]; recoveryKey: string }>();
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
    setLink(`${data.link}#k=${await exportKey(oneOff)}`);
    setInvites((list) => [...list, { ...data.invite, expiresAt: String(data.invite.expiresAt) }]);
    setSeats((s) => ({ ...s, pending: s.pending + 1, used: s.used + 1 }));
    setEmail("");
  }

  async function cancel(i: Invite) {
    const res = await fetch(`/api/team/invites/${i.id}`, { method: "DELETE" });
    if (!res.ok) return;
    setInvites((list) => list.filter((x) => x.id !== i.id));
    setSeats((s) => ({ ...s, pending: s.pending - 1, used: s.used - 1 }));
  }

  async function changeRole(m: Member, next: Role) {
    setError(undefined);
    const res = await fetch(`/api/team/members/${m.userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: next }) });
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Could not change the role");
    setMembers((list) => list.map((x) => (x.userId === m.userId ? { ...x, role: next } : x)));
  }

  async function setPerm(m: Member, key: keyof Perms, value: boolean) {
    setError(undefined);
    setMembers((list) => list.map((x) => (x.userId === m.userId ? { ...x, perms: { ...x.perms, [key]: value } } : x)));
    const error = await savePerm(m.userId, key, value);
    if (error) {
      setMembers((list) => list.map((x) => (x.userId === m.userId ? { ...x, perms: { ...x.perms, [key]: !value } } : x)));
      setError(error);
    }
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
      const toSend = await Promise.all(
        (data.links as { id: string; link: string }[])
          .filter((l) => !names.get(l.id)?.hasEmail)
          .map(async (l) => {
            const key = newClientKeys.get(l.id);
            return { id: l.id, name: names.get(l.id)?.name ?? "Client", link: key ? `${l.link}#k=${await exportKey(key)}` : l.link };
          }),
      );
      setReset({ name: m?.name ?? keyResetNeeded ?? null, removed: !!m, emailed: data.emailed, toSend, recoveryKey: await exportKey(team) });
      setResetDue(false);
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

  return (
    <>
      <section className="rounded-2xl border border-line bg-surface p-6">
        <p className="text-sm font-medium text-dim">Staff logins</p>
        <p className="mt-1 text-3xl font-semibold text-ink">
          {seats.used} <span className="text-lg font-normal text-dim">of {seats.limit} used</span>
        </p>
        <p className="mt-1 text-xs text-dim">
          {includedStaff} included with your plan{extraStaff > 0 && ` + ${extraStaff} extra`}
          {seats.pending > 0 && ` · ${seats.pending} waiting to join`}
        </p>
        {canBuyStaff && <PurchaseNotice one="staff login" many="staff logins" where="Invite someone below to use them." />}
        {canBuyStaff && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-5 text-sm">
            <span className="text-muted">Need more?</span>
            <select value={buyQty} onChange={(e) => setBuyQty(Number(e.target.value))} aria-label="Extra staff logins" className="rounded-lg border border-line-strong bg-surface px-2 py-1.5">
              {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n} {n === 1 ? "login" : "logins"}</option>)}
            </select>
            <button onClick={() => setConfirming({ kind: "buy" })} className="rounded-lg bg-solid px-3 py-1.5 font-medium text-white hover:bg-solid-hover">Add for {money(buyQty * staffPrice)}/{per}</button>
            <span className="w-full sm:hidden" />
            <span className="sm:ml-auto">
              <RemoveExtras extra={extraStaff} spare={seats.limit - seats.used} noun={{ one: "staff login", many: "staff logins", holder: "staff or cancel invites" }} endpoint="/api/billing/staff" field="extraStaff" onError={setError} />
            </span>
          </div>
        )}
      </section>

      {canManage && (
        <section className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-semibold text-ink">Invite someone</h2>
          <form onSubmit={invite} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Their email (optional: then only they can join)" aria-label="Staff email" className="rounded-lg border border-line-strong px-3 py-2 text-sm" />
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} aria-label="Role" className="rounded-lg border border-line-strong bg-surface px-2 py-2 text-sm">
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button disabled={busy || full} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">Create invite link</button>
          </form>
          <p className="mt-2 text-xs text-dim">Members record, send and reply to the clients assigned to them; you choose what else each one can do below. Admins have full access and can also invite staff, assign clients and remove them.</p>
          {full && <p className="mt-2 text-sm text-warn-fg">{seats.limit === 1 ? "Team logins come with Studio and Agency." : "All staff logins are in use."}</p>}
          {link && (
            <div className="mt-4 rounded-xl border border-ok-line bg-ok-bg p-4 text-sm">
              <p className="font-medium text-ok-fg">Send this link to them yourself. It works once and expires in 7 days.</p>
              <p data-testid="invite-link" className="mt-2 break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs text-ink">{link}</p>
              <button
                onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="mt-2 rounded-lg border border-ok-line bg-surface px-3 py-1.5 hover:bg-hover">
                {copied ? "Copied" : "Copy link"}
              </button>
              <p className="mt-2 text-xs text-ok-fg">It carries the key that unlocks your team&apos;s encrypted videos, so we can&apos;t email it for you.</p>
            </div>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-danger-fg">{error}</p>}
        </section>
      )}

      {resetDue && canManage && (
        <section role="alert" className="rounded-2xl border border-warn-line bg-warn-bg p-6 text-sm text-warn-fg">
          <h2 className="font-semibold">{keyResetNeeded} left the team and still holds its keys</h2>
          <p className="mt-1">Reset your team&apos;s keys and every client&apos;s personal link so they can&apos;t open anything through {BRAND.name} again. Clients with an email get their new link automatically.</p>
          <button onClick={() => resetKeys()} disabled={!!removing} className="mt-3 rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
            {removing === "reset" ? "Resetting keys…" : "Reset keys now"}
          </button>
        </section>
      )}
      {reset && <ResetDone {...reset} business={business} />}
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
                {canManage && m.role !== "OWNER" ? (
                  <select aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => changeRole(m, e.target.value as Role)} className="rounded-lg border border-line-strong bg-surface px-2 py-1.5">
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                ) : (
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">{ROLE_LABEL[m.role]}</span>
                )}
                {m.role !== "OWNER" && canManage && m.userId !== meId && (
                  <button onClick={() => remove(m)} disabled={!!removing || !!checking} data-testid="remove-member" className="rounded-lg px-3 py-1.5 text-dim hover:bg-hover hover:text-danger-fg disabled:opacity-50">
                    {removing === m.userId ? "Resetting keys…" : checking === m.userId ? "Checking…" : "Remove"}
                  </button>
                )}
              </div>
              {m.role === "MEMBER" && (canManage || m.userId === meId) && (
                <PermChecks name={m.name} email={m.email} perms={m.perms} self={m.userId === meId} editable={canManage && m.userId !== meId} onChange={(key, value) => setPerm(m, key, value)} />
              )}
            </li>
          ))}
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
              <div>
                <p className="font-medium text-muted">{i.email ?? "Invite link"}</p>
                <p className="text-xs text-dim">Waiting to join · {ROLE_LABEL[i.role]} · expires {dates.day(new Date(i.expiresAt))}</p>
              </div>
              <button onClick={() => cancel(i)} className="rounded-lg px-3 py-1.5 text-sm text-dim hover:bg-hover hover:text-danger-fg">Cancel invite</button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function ResetDone({ name, removed, emailed, toSend, recoveryKey, business }: { name: string | null; removed: boolean; emailed: number; toSend: { id: string; name: string; link: string }[]; recoveryKey: string; business: string }) {
  const [copied, setCopied] = useState<string>();
  const copy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(undefined), 2000);
  };
  return (
    <section role="status" data-testid="key-reset" className="rounded-2xl border border-ok-line bg-ok-bg p-6 text-sm text-ok-fg">
      <h2 className="font-semibold">{removed ? `${name} was removed and your keys were reset` : "Your keys were reset"}</h2>
      {removed && <p className="mt-1">If they sign in again, they&apos;re told they were removed from your team.</p>}
      <p className="mt-1">
        Every client has a new personal link and their old links no longer work.
        {emailed > 0 && ` ${emailed} ${emailed === 1 ? "client was" : "clients were"} emailed their new link.`}
        {" "}Pending invites were cancelled. Your team&apos;s other devices update on their own.
      </p>
      {toSend.length > 0 && (
        <>
          <p className="mt-4 font-medium">These clients have no email on file, so they can&apos;t open their videos until you send them their new link:</p>
          <ul className="mt-2 grid gap-2">
            {toSend.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2 text-ink">
                <span>{c.name}</span>
                <button onClick={() => copy(c.id, c.link)} className="rounded-lg border border-line-strong px-3 py-1 hover:bg-hover">{copied === c.id ? "Copied" : "Copy new link"}</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-4 font-medium">Your new recovery key</p>
      <p className="mt-1">Save it somewhere safe. Your old recovery key only works for people still on the team.</p>
      <KeyText value={recoveryKey} testId="new-recovery-key" className="mt-2" />
      <div className="mt-2"><KeyActions value={recoveryKey} business={business} /></div>
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
      <h2 className="font-semibold text-ink">Your workspaces</h2>
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
  const emailed = active.filter((c) => c.hasEmail);
  const noEmail = active.filter((c) => !c.hasEmail);
  const names = (list: { name: string }[]) => (list.length > 12 ? `${list.slice(0, 12).map((c) => c.name).join(", ")} and ${list.length - 12} more` : list.map((c) => c.name).join(", "));
  return (
    <Dialog title={`Remove ${member.name}?`} confirmLabel="Remove and reset links" danger onCancel={onCancel} onConfirm={onConfirm}>
      <p>
        They lose access straight away. So they can&apos;t open anything they saw before, your team&apos;s keys are reset and every client gets a new personal link. Old links stop working.
      </p>
      {active.length === 0 ? (
        <p>You have no clients yet, so no links change.</p>
      ) : (
        <>
          {emailed.length > 0 && (
            <div data-testid="remove-emailed">
              <p className="font-medium text-ink">{emailed.length} {emailed.length === 1 ? "client gets" : "clients get"} their new link by email</p>
              <p>{names(emailed)}</p>
            </div>
          )}
          {noEmail.length > 0 && (
            <div className="rounded-xl border border-warn-line bg-warn-bg p-3 text-warn-fg" data-testid="remove-no-email">
              <p className="font-medium">{noEmail.length} {noEmail.length === 1 ? "client has" : "clients have"} no email</p>
              <p>{names(noEmail)}</p>
              <p className="mt-1">Straight after, you&apos;ll get their new links here to copy and send yourself.</p>
            </div>
          )}
        </>
      )}
      <p>Their recordings stay with your business, and the clients they looked after become unassigned.</p>
    </Dialog>
  );
}
