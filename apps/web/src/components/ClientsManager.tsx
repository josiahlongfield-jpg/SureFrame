"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { exportKey, fingerprint, generateKey, unwrapKey, wrapKey } from "@/lib/e2e/crypto";
import { zoned } from "@/lib/dates";
import TeamKeyGate from "./TeamKeyGate";
import RemoveExtras from "./RemoveExtras";

type Seats = { used: number; limit: number };
type Client = { id: string; name: string; email: string | null; link: string; teamKeyWrap: string | null; videoCount: number; assignedToId: string | null; paused?: boolean; linkOff?: boolean };
type Staff = { id: string; name: string };
/** A removed client the business can still restore. Dates are ISO strings. */
type Removed = { id: string; name: string; email: string | null; removedAt: string; purgeAt: string | null };

/** US$37.50, US$45 */
const money = (n: number) => `US$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** A client's personal link, with their decryption key in the #fragment (never sent to the server). */
export async function personalLink(link: string, teamKeyWrap: string | null, teamKey: CryptoKey) {
  if (!teamKeyWrap) return link;
  const clientKey = await unwrapKey(teamKeyWrap, teamKey);
  return `${link}#k=${await exportKey(clientKey)}`;
}

/** Remembers that the team copied a client's link to send it, so new videos get a plain Send. */
export function markLinkSent(clientId: string) {
  return fetch(`/api/clients/${clientId}/link-sent`, { method: "POST" }).catch(() => {});
}

type Props = {
  workspaceId: string;
  fingerprint: string | null;
  initialClients: Client[];
  initialSeats: Seats;
  includedSeats: number;
  extraSeats: number;
  seatPrice: number;
  /** How often the subscription bills, so the seat price is shown per month or per year. */
  per?: "month" | "year";
  canBuySeats: boolean;
  /** On a free plan we gave: seats are bought once they start paying. */
  complimentary?: boolean;
  /** Owners and admins assign and remove clients; members record and reply. */
  canManage: boolean;
  /** May add new clients (staff can be stopped by the owner or an admin). */
  canAdd: boolean;
  /** Sees every client, not only their own. Staff without it get only their clients from the server. */
  seesAll: boolean;
  /** Only the owner handles billing. */
  isOwner: boolean;
  meId: string;
  /** Everyone on the team. The assignment controls only show with two or more. */
  staff: Staff[];
  /** Solo plans: suggest Studio once extra seats would cost about as much. */
  studioHint?: { soloBase: number; studioPrice: number; studioClients: number };
  /** Owners and admins: removed clients kept until their deletion date. */
  initialRemoved?: Removed[];
  /** Days a removed client is kept before being deleted. */
  keepDays: number;
  /** Scroll to the removed clients (links in emails). */
  openRemoved?: boolean;
  /** The business's time zone, for dates. */
  timezone: string | null;
  /** Cloud backup is on: recordings stay until the client is deleted. Without it they still expire on their usual dates. */
  cloudBackup?: boolean;
};

export default function ClientsManager({ workspaceId, fingerprint, ...rest }: Props) {
  return (
    <TeamKeyGate workspaceId={workspaceId} fingerprint={fingerprint}>
      {(teamKey) => <Manager {...rest} teamKey={teamKey} />}
    </TeamKeyGate>
  );
}

function Manager({
  teamKey,
  initialClients,
  initialSeats,
  includedSeats,
  extraSeats,
  seatPrice,
  per = "month",
  canBuySeats,
  complimentary = false,
  canManage,
  canAdd,
  seesAll,
  isOwner,
  meId,
  staff,
  studioHint,
  initialRemoved = [],
  keepDays,
  openRemoved = false,
  timezone,
  cloudBackup = false,
}: Omit<Props, "workspaceId" | "fingerprint"> & { teamKey: CryptoKey }) {
  const [clients, setClients] = useState(initialClients);
  const [seats, setSeats] = useState(initialSeats);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string>();
  const [buyQty, setBuyQty] = useState(5);
  const [removed, setRemoved] = useState(initialRemoved);
  // The client being removed, and the date they'd be kept until.
  const [confirming, setConfirming] = useState<{ id: string; until: Date } | null>(null);
  const [tellClient, setTellClient] = useState(true);
  const [working, setWorking] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [listError, setListError] = useState<string>();
  const removedSection = useRef<HTMLElement>(null);
  useEffect(() => {
    if (openRemoved) removedSection.current?.scrollIntoView({ block: "start" });
  }, [openRemoved]);
  const dates = zoned(timezone);
  const first = (name: string) => name.split(" ")[0];
  // Adding someone who was removed: offer to restore them instead, so their history comes back.
  const typed = email.trim().toLowerCase();
  const removedMatch = typed ? removed.find((r) => r.email?.toLowerCase() === typed) : undefined;
  // Staff start on their own clients; owners and admins on everyone.
  const [show, setShow] = useState<"all" | "mine">(canManage ? "all" : "mine");
  const full = seats.used >= seats.limit;
  // Tabs only make sense when there are other people's clients to see.
  const team = staff.length > 1 && seesAll;
  const shown = show === "mine" ? clients.filter((c) => c.assignedToId === meId) : clients;
  const staffName = (id: string | null) => staff.find((p) => p.id === id)?.name;
  // What Solo would cost after this purchase, against Studio's flat price.
  const soloAfter = studioHint ? studioHint.soloBase + (extraSeats + buyQty) * seatPrice : 0;
  const suggestStudio = studioHint && soloAfter >= studioHint.studioPrice - 5;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Each client gets their own key, created here and stored only wrapped with the team key.
      body: JSON.stringify({ name, email, teamKeyWrap: await wrapKey(await generateKey(), teamKey), keyFingerprint: await fingerprint(teamKey) }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not add client");
    setClients((c) => [...c, data.client].sort((a, b) => a.name.localeCompare(b.name)));
    setSeats((s) => ({ ...s, used: s.used + 1 }));
    setName("");
    setEmail("");
  }

  function askRemove(c: Client) {
    setConfirming({ id: c.id, until: new Date(Date.now() + keepDays * 86_400_000) });
    setTellClient(true);
    setNotice(undefined);
    setListError(undefined);
  }

  async function remove(c: Client) {
    setWorking(c.id);
    setListError(undefined);
    const res = await fetch(`/api/clients/${c.id}${c.email && tellClient ? "?notify=1" : ""}`, { method: "DELETE" }).catch(() => null);
    setWorking(undefined);
    if (!res?.ok) return setListError((await res?.json().catch(() => ({})))?.error ?? "Couldn't remove the client. Check your connection and try again.");
    const now = new Date();
    const until = new Date(now.getTime() + keepDays * 86_400_000);
    setClients((list) => list.filter((x) => x.id !== c.id));
    setSeats((s) => ({ ...s, used: s.used - 1 }));
    setRemoved((list) => [{ id: c.id, name: c.name, email: c.email, removedAt: now.toISOString(), purgeAt: until.toISOString() }, ...list]);
    setConfirming(null);
    setNotice(`${c.name} removed. You can restore them until ${dates.longDay(until)}.`);
  }

  async function restore(r: Removed) {
    setWorking(r.id);
    setNotice(undefined);
    setListError(undefined);
    const res = await fetch(`/api/clients/${r.id}/restore`, { method: "POST" }).catch(() => null);
    const data = (await res?.json().catch(() => null)) ?? {};
    setWorking(undefined);
    if (!res?.ok) {
      // Already deleted, or already restored elsewhere.
      if (res?.status === 404 || res?.status === 409) setRemoved((list) => list.filter((x) => x.id !== r.id));
      return setListError(data.error ?? "Couldn't restore the client. Check your connection and try again.");
    }
    setRemoved((list) => list.filter((x) => x.id !== r.id));
    setClients((list) => [...list.filter((x) => x.id !== r.id), data.client].sort((a, b) => a.name.localeCompare(b.name)));
    setSeats(data.seats);
    // Restored from the add form's hint: they're not being added again.
    if (removedMatch?.id === r.id) {
      setName("");
      setEmail("");
    }
    setNotice(
      !data.newLink
        ? `${r.name} is back, and their personal link works again.`
        : data.emailed
          ? `${r.name} is back. Your team's keys were reset while they were removed, so they have a new personal link, which we've emailed to them.`
          : `${r.name} is back. Your team's keys were reset while they were removed, so they have a new personal link. Copy it below and send it to them.`,
    );
  }

  async function assign(c: Client, assignedToId: string | null) {
    setError(undefined);
    const res = await fetch(`/api/clients/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignedToId }),
    });
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Could not assign client");
    setClients((list) => list.map((x) => (x.id === c.id ? { ...x, assignedToId } : x)));
  }

  async function copy(c: Client) {
    await navigator.clipboard.writeText(await personalLink(c.link, c.teamKeyWrap, teamKey));
    void markLinkSent(c.id);
    setCopied(c.id);
    setTimeout(() => setCopied(undefined), 2000);
  }

  async function buySeats() {
    if (!confirm(`Add ${buyQty} extra client ${buyQty === 1 ? "seat" : "seats"} for ${money(buyQty * seatPrice)} a ${per}, plus any tax? You're charged today for the rest of this billing period, then it renews with your plan.`)) return;
    setError(undefined);
    const res = await fetch("/api/billing/seats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraSeats: extraSeats + buyQty }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.url) return void (window.location.href = data.url);
    if (!res.ok) return setError(data.error ?? "Could not add seats");
    window.location.reload();
  }

  return (
    <div className="mt-8 grid gap-6">
      <section className="rounded-2xl border border-line bg-surface p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-dim">Client seats</p>
            <p className="mt-1 text-3xl font-semibold text-ink">
              {seats.used} <span className="text-lg font-normal text-dim">of {seats.limit} used</span>
            </p>
            <p className="mt-1 text-xs text-dim">
              {includedSeats} included with your plan{extraSeats > 0 && ` + ${extraSeats} extra`}
            </p>
          </div>
          <div
            role="progressbar"
            aria-label="Client seats used"
            aria-valuemin={0}
            aria-valuenow={seats.used}
            aria-valuemax={seats.limit}
            className="h-2 w-full overflow-hidden rounded-full bg-surface-2 sm:w-64"
          >
            <div className={`h-full ${full ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(100, (seats.used / Math.max(1, seats.limit)) * 100)}%` }} />
          </div>
        </div>
        {!isOwner ? null : canBuySeats ? (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-5 text-sm">
            <span className="text-muted">Need more?</span>
            <select value={buyQty} onChange={(e) => setBuyQty(Number(e.target.value))} aria-label="Extra clients" className="rounded-lg border border-line-strong bg-surface px-2 py-1.5">
              {[1, 5, 10, 25, 50].map((n) => <option key={n} value={n}>{n} {n === 1 ? "client" : "clients"}</option>)}
            </select>
            <button onClick={buySeats} className="rounded-lg bg-solid px-3 py-1.5 font-medium text-white hover:bg-solid-hover">
              Add for {money(buyQty * seatPrice)}/{per}
            </button>
            <span className="w-full sm:hidden" />
            <span className="sm:ml-auto">
              <RemoveExtras extra={extraSeats} spare={seats.limit - seats.used} noun={{ one: "client seat", many: "client seats", holder: "clients" }} endpoint="/api/billing/seats" field="extraSeats" onError={setError} />
            </span>
            {suggestStudio && (
              <p data-testid="studio-hint" className="mt-3 w-full rounded-lg bg-primary-soft px-3 py-2 text-ink">
                That would bring Solo to {money(soloAfter)}/month. Studio is {money(studioHint.studioPrice)}/month with {studioHint.studioClients} clients and 3 staff logins (yours included).{" "}
                <Link href="/pricing" className="font-medium underline">Compare plans</Link>
              </p>
            )}
          </div>
        ) : complimentary ? (
          <p className="mt-5 border-t border-line pt-5 text-sm text-muted" data-testid="comp-seats-note">
            Extra clients can be added once you start a paid subscription. <Link href="/pricing" className="font-medium text-accent hover:underline">Choose a paid plan</Link>
          </p>
        ) : (
          <p className="mt-5 border-t border-line pt-5 text-sm text-muted">
            <Link href="/pricing" className="font-medium text-accent hover:underline">Upgrade</Link> for 10 or more clients, with extra clients at {money(seatPrice)} each per month.
          </p>
        )}
      </section>

      {canAdd && (
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="font-semibold text-ink">Add a client</h2>
        <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Name" aria-label="Client name" className="rounded-lg border border-line-strong px-3 py-2 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email (optional)" aria-label="Client email" className="rounded-lg border border-line-strong px-3 py-2 text-sm" />
          <button disabled={busy || full} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50">
            Add client
          </button>
        </form>
        {removedMatch && (
          <p className="mt-2 text-sm text-muted" data-testid="removed-match">
            {removedMatch.name} was removed on {dates.day(new Date(removedMatch.removedAt))}. Restore them instead to keep their history.{" "}
            <button type="button" onClick={() => restore(removedMatch)} disabled={full || working === removedMatch.id} className="font-medium text-accent hover:underline disabled:opacity-50">
              Restore {first(removedMatch.name)}
            </button>
          </p>
        )}
        {full && (
          <p className="mt-2 text-sm text-warn-fg" data-testid="seats-full">
            All {seats.limit} client seats are in use.{" "}
            {!isOwner
              ? "Ask the owner to add seats, or remove a client to add someone new."
              : canBuySeats
                ? "Add seats above, or remove a client to add someone new."
                : "Upgrade your plan, or remove a client to add someone new."}
          </p>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-danger-fg">{error}</p>}
      </section>
      )}

      {(notice || listError) && (
        <p role={listError ? "alert" : "status"} data-testid="clients-notice" className={`rounded-xl border p-3 text-sm ${listError ? "border-danger-line bg-danger-bg text-danger-fg" : "border-ok-line bg-ok-bg text-ok-fg"}`}>
          {listError ?? notice}
        </p>
      )}

      <section className="rounded-2xl border border-line bg-surface">
        {team && (
          <div role="tablist" aria-label="Which clients" className="flex gap-1 border-b border-line px-4 pt-3 text-sm">
            {(["all", "mine"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={show === k} onClick={() => setShow(k)}
                className={`rounded-t-lg px-3 py-2 ${show === k ? "border-b-2 border-primary font-medium text-ink" : "text-dim hover:text-ink"}`}>
                {k === "all" ? `All clients (${clients.length})` : `My clients (${clients.filter((c) => c.assignedToId === meId).length})`}
              </button>
            ))}
          </div>
        )}
        {shown.length === 0 ? (
          <p className="p-6 text-sm text-dim">{clients.length === 0 && seesAll ? "No clients yet." : "No clients are assigned to you yet."}</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                <div>
                  <Link href={`/clients/${c.id}`} className="font-medium text-ink hover:text-accent hover:underline">{c.name}</Link>
                  {c.paused && (
                    <span className="ml-2 rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn-fg" data-testid="client-paused-badge" title="Over your plan's client limit">
                      Paused
                    </span>
                  )}
                  {c.linkOff && (
                    <span className="ml-2 rounded-full bg-danger-bg px-2 py-0.5 text-xs font-semibold text-danger-fg" data-testid="client-link-off-badge" title="Turned off by SureFrame support">
                      Link off
                    </span>
                  )}
                  <p className="text-xs text-dim">
                    {c.email ? `${c.email} · ` : ""}{c.videoCount} {c.videoCount === 1 ? "video" : "videos"}
                    {staff.length > 1 && seesAll && !canManage && ` · ${staffName(c.assignedToId) ?? "Shared"}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  {staff.length > 1 && canManage && (
                    <select aria-label={`Who looks after ${c.name}`} value={c.assignedToId ?? ""} onChange={(e) => assign(c, e.target.value || null)}
                      className="rounded-lg border border-line-strong bg-surface px-2 py-1.5">
                      <option value="">Shared</option>
                      {staff.map((p) => <option key={p.id} value={p.id}>{p.id === meId ? `${p.name} (you)` : p.name}</option>)}
                    </select>
                  )}
                  {!c.linkOff && (
                    <button onClick={() => copy(c)} className="rounded-lg border border-line-strong px-3 py-1.5 hover:bg-hover">
                      {copied === c.id ? "Copied" : "Copy personal link"}
                    </button>
                  )}
                  {canManage && <button onClick={() => askRemove(c)} className="rounded-lg px-3 py-1.5 text-dim hover:bg-hover hover:text-danger-fg">Remove</button>}
                </div>
                {confirming?.id === c.id && (
                  <div data-testid="remove-client-confirm" className="w-full rounded-xl border border-danger-line bg-danger-bg p-4 text-sm text-muted">
                    <p className="font-medium text-ink">Remove {c.name}? Their personal link stops working now and their seat is freed.</p>
                    <p className="mt-2">
                      Their videos, conversations, to-dos and notes are kept until {dates.longDay(confirming.until)}, so you can restore them from Removed clients on this page.
                      {!cloudBackup && " Recordings without cloud backup still leave our servers on their usual dates, and restoring doesn't bring those back."}
                    </p>
                    <p className="mt-2">
                      After that they&apos;re deleted for good, including your team&apos;s replies to them, even with cloud backup on. Recordings you also sent to other clients stay with those clients.
                    </p>
                    {c.email && (
                      <label className="mt-3 flex items-center gap-2">
                        <input type="checkbox" checked={tellClient} onChange={(e) => setTellClient(e.target.checked)} data-testid="remove-client-email" />
                        Email {first(c.name)} that their access has ended
                      </label>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={() => remove(c)} disabled={working === c.id} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                        Remove {first(c.name)}
                      </button>
                      <button onClick={() => setConfirming(null)} className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 hover:bg-hover">Cancel</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && removed.length > 0 && (
        <section ref={removedSection} data-testid="removed-clients" className="scroll-mt-6 rounded-2xl border border-line bg-surface">
          <div className="px-6 pt-5">
            <h2 className="font-semibold text-ink">Removed clients</h2>
            <p className="mt-1 text-sm text-dim">
              Their links don&apos;t work and they don&apos;t use a seat. They&apos;re kept until the date shown, then deleted for good with their videos, conversations, to-dos and notes.
              {!cloudBackup && " Recordings without cloud backup still leave our servers on their usual dates before then, and restoring doesn't bring those back."} Restoring uses a client
              seat.
            </p>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {removed.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                <div>
                  <p className="font-medium text-ink">{r.name}</p>
                  <p className="text-xs text-dim">
                    {r.email ? `${r.email} · ` : ""}Removed {dates.day(new Date(r.removedAt))}
                    {r.purgeAt && ` · deleted for good after ${dates.dayTime(new Date(r.purgeAt))} ${dates.zoneName(new Date(r.purgeAt))}`}
                  </p>
                </div>
                <button
                  onClick={() => restore(r)}
                  disabled={full || working === r.id}
                  title={full ? "Free a seat or add seats to restore" : undefined}
                  data-testid="restore-client"
                  className="rounded-lg border border-line-strong px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50"
                >
                  {working === r.id ? "Restoring…" : "Restore"}
                </button>
              </li>
            ))}
          </ul>
          {full && <p className="px-6 pb-4 text-xs text-warn-fg">All client seats are in use. Free a seat or add seats to restore someone.</p>}
        </section>
      )}
    </div>
  );
}
