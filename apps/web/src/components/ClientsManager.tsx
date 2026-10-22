"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { exportKey, fingerprint, generateKey, unwrapKey, wrapKey } from "@/lib/e2e/crypto";
import { zoned } from "@/lib/dates";
import { shareLink, useCanShare, writeClipboard } from "@/lib/clipboard";
import TeamKeyGate from "./TeamKeyGate";
import RemoveExtras from "./RemoveExtras";
import { ReplyBadges, type Conv } from "./LibraryTools";
import FirstLinkSender, { PersonalLinkSteps } from "./FirstLinkSender";
import { DialogButtons, DialogShell, dangerButton, quietButton } from "./ConfirmDialog";

type Seats = { used: number; limit: number };
/** `reached`: the client has opened their personal link, so emailed videos open for them. `linkSent`: the team copied or shared it. */
/** `replaced`: the team's keys were reset recently and the client got a new personal link then (ISO date), and whether we emailed it. */
type Client = { id: string; name: string; email: string | null; link: string; teamKeyWrap: string | null; videoCount: number; assignedToId: string | null; paused?: boolean; linkOff?: boolean; reached?: boolean; linkSent?: boolean; convs?: Conv[]; replaced?: { at: string; emailed: boolean } | null };
type Staff = { id: string; name: string };
/** A removed client the business can still restore. Dates are ISO strings. */
type Removed = { id: string; name: string; email: string | null; removedAt: string; purgeAt: string | null };

/** US$37.50, US$45 */
const money = (n: number) => `US$${Number.isInteger(n) ? n : n.toFixed(2)}`;
/** Longest client name, as the server allows (lib/clients.ts). */
const NAME_MAX = 80;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A client's personal link, with their decryption key in the #fragment (never sent to the server). */
export async function personalLink(link: string, teamKeyWrap: string | null, teamKey: CryptoKey) {
  if (!teamKeyWrap) return link;
  const clientKey = await unwrapKey(teamKeyWrap, teamKey);
  return `${link}#k=${await exportKey(clientKey)}`;
}

/** Remembers that the team copied a client's link to send it (shown to support; the client counts as reached only once they open it). */
export function markLinkSent(clientId: string) {
  return fetch(`/api/clients/${clientId}/link-sent`, { method: "POST" }).catch(() => {});
}

type Props = {
  workspaceId: string;
  /** The business's name, signed at the end of the message sent with a personal link. */
  business: string;
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
  /** Seats just bought (after the reload), to confirm it. */
  seatsAdded?: number;
};

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** "jane.doe@x.com" -> "Jane Doe" */
function nameFromEmail(email: string) {
  return email.split("@")[0].split(/[._\-+]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || email;
}

/**
 * A pasted list of clients, one per line: "Name, email", "Name <email>", a
 * spreadsheet row (name, tab, email), just an email, or just a name.
 */
export function parseClientList(text: string) {
  const out: { name: string; email?: string; line: string }[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const angle = line.match(/^(.*?)<([^>]+)>\s*$/);
    const parts = angle ? [angle[1], angle[2]] : line.split(/\t|,|;/);
    let cells = parts.map((p) => p.trim().replace(/^"|"$/g, "")).filter(Boolean);
    // "Client D client-d@example.com", with only a space between: the email is the word with an @.
    if (cells.length === 1 && /\s/.test(cells[0]) && cells[0].includes("@")) {
      const words = cells[0].split(/\s+/);
      const at = words.filter((w) => w.includes("@"));
      if (at.length === 1) cells = [words.filter((w) => !w.includes("@")).join(" "), at[0]].filter(Boolean);
    }
    const email = cells.find((c) => c.includes("@"));
    const name = cells.find((c) => !c.includes("@"));
    if (email && !EMAIL.test(email)) bad.push(line);
    else if (!name && !email) bad.push(line);
    else out.push({ name: (name ?? nameFromEmail(email!)).slice(0, NAME_MAX), email: email?.toLowerCase(), line });
  }
  return { clients: out, bad };
}

export default function ClientsManager({ workspaceId, fingerprint, ...rest }: Props) {
  return (
    <TeamKeyGate workspaceId={workspaceId} fingerprint={fingerprint}>
      {(teamKey) => <Manager {...rest} teamKey={teamKey} />}
    </TeamKeyGate>
  );
}

type Filter = "all" | "first" | "no-email" | "paused";

function Manager({
  teamKey,
  business,
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
  seatsAdded,
}: Omit<Props, "workspaceId" | "fingerprint"> & { teamKey: CryptoKey }) {
  const [clients, setClients] = useState(initialClients);
  const [seats, setSeats] = useState(initialSeats);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [bulk, setBulk] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string>();
  const [buyQty, setBuyQty] = useState(1);
  const [buying, setBuying] = useState<"ask" | "busy" | null>(null);
  const [removed, setRemoved] = useState(initialRemoved);
  // The client being removed, and the date they'd be kept until.
  const [confirming, setConfirming] = useState<{ id: string; until: Date } | null>(null);
  const [tellClient, setTellClient] = useState(true);
  const [working, setWorking] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [assigned, setAssigned] = useState<{ id: string; text: string }>();
  const [listError, setListError] = useState<string>();
  // The clients just added: sending their personal link is the next step.
  const [justAdded, setJustAdded] = useState<Client[]>([]);
  // Names from a pasted list that didn't fit in the seats left.
  const [unfit, setUnfit] = useState<string[]>([]);
  // Lines of a pasted list that couldn't be read: kept in the box to fix, never dropped.
  const [unread, setUnread] = useState<string[]>([]);
  const addedNote = useRef<HTMLDivElement>(null);
  // On a phone the note can land below the fold; bring it into view.
  useEffect(() => {
    if (justAdded.length) addedNote.current?.scrollIntoView?.({ block: "nearest" });
  }, [justAdded]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const canShare = useCanShare();
  const removedSection = useRef<HTMLElement>(null);
  const listTop = useRef<HTMLElement>(null);
  // Each row's Remove client button, so focus goes back to it when its dialog closes.
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const noticeLine = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (openRemoved) removedSection.current?.scrollIntoView({ block: "start" });
  }, [openRemoved]);
  const dates = zoned(timezone);
  const left = Math.max(0, seats.limit - seats.used);
  // Adding someone who was removed: offer to restore them instead, so their history comes back.
  const typed = email.trim().toLowerCase();
  const removedMatch = typed ? removed.find((r) => r.email?.toLowerCase() === typed) : undefined;
  // Adding someone already on the list: say so before they press Add (the server refuses it too).
  const typedName = name.trim().toLowerCase();
  const activeMatch = typed
    ? clients.find((c) => c.email?.toLowerCase() === typed)
    : typedName
      ? clients.find((c) => !c.email && c.name.trim().toLowerCase() === typedName)
      : undefined;
  const sameEmail = (e: string | null, id: string) => (e ? clients.find((c) => c.id !== id && c.email?.toLowerCase() === e.toLowerCase()) : undefined);
  // Staff start on their own clients; owners and admins on everyone.
  const [show, setShow] = useState<"all" | "mine">(canManage ? "all" : "mine");
  const full = seats.used >= seats.limit;
  // Buying seats only comes up once they're nearly all used (or some bought ones could be given back).
  const nearlyFull = left <= Math.max(2, Math.ceil(seats.limit * 0.1));
  // Tabs only make sense when there are other people's clients to see.
  const team = staff.length > 1 && seesAll;
  const q = query.trim().toLowerCase();
  const inTab = show === "mine" ? clients.filter((c) => c.assignedToId === meId) : clients;
  const shown = inTab.filter(
    (c) =>
      (!q || c.name.toLowerCase().includes(q) || !!c.email?.toLowerCase().includes(q)) &&
      (filter === "all" || (filter === "first" && !c.reached && !c.linkOff) || (filter === "no-email" && !c.email) || (filter === "paused" && (c.paused || c.linkOff))),
  );
  const waiting = clients.filter((c) => !c.reached && !c.linkOff).length;
  const staffName = (id: string | null) => staff.find((p) => p.id === id)?.name;
  // What Solo would cost after this purchase, against Studio's flat price.
  const soloAfter = studioHint ? studioHint.soloBase + (extraSeats + buyQty) * seatPrice : 0;
  const suggestStudio = studioHint && soloAfter >= studioHint.studioPrice - 5;
  const buyHref = isOwner && canBuySeats ? "#buy-seats" : "/pricing";

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setNotice(undefined);
    if (name.trim().length > NAME_MAX) return setError(`That name is too long. Names can be up to ${NAME_MAX} characters.`);
    if (activeMatch) return;
    setBusy(true);
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
    setJustAdded([data.client]);
    setUnfit([]);
    setUnread([]);
    setName("");
    setEmail("");
  }

  // Pasting a whole list: everyone not already on the list, added in one go (as many as there are seats for).
  const known = new Set(clients.flatMap((c) => (c.email ? [c.email.toLowerCase()] : [])));
  const parsed = bulk ? parseClientList(bulk) : null;
  const fresh = parsed ? parsed.clients.filter((c, i, all) => !c.email || (!known.has(c.email) && all.findIndex((x) => x.email === c.email) === i)) : [];
  const dupes = parsed ? parsed.clients.length - fresh.length : 0;
  const fits = fresh.slice(0, left);
  // The seat-buying row: when seats are nearly used, or a pasted list doesn't fit (its "Add seats" link goes there).
  const showBuy = nearlyFull || fresh.length > left || unfit.length > 0;
  async function addMany() {
    if (!fits.length) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    const list = await Promise.all(fits.map(async (c) => ({ name: c.name, email: c.email, teamKeyWrap: await wrapKey(await generateKey(), teamKey) })));
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clients: list, keyFingerprint: await fingerprint(teamKey) }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not add those clients");
    setClients((c) => [...c, ...data.clients].sort((a, b) => a.name.localeCompare(b.name)));
    setSeats((s) => ({ ...s, used: s.used + data.clients.length }));
    // Lines to fix and those that didn't fit stay in the box, ready to correct or for when there are more seats.
    const rest = fresh.slice(fits.length);
    const bad = parsed?.bad ?? [];
    const keep = [...bad, ...rest.map((c) => c.line)];
    setBulk(keep.length ? keep.join("\n") : null);
    setUnfit(rest.map((c) => c.name));
    setUnread(bad);
    // The note under the form says what was added and what's next.
    setJustAdded(data.clients);
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
    // Never tell someone their access ended while another client on the list still uses their email.
    const notify = !!c.email && tellClient && !sameEmail(c.email, c.id);
    const res = await fetch(`/api/clients/${c.id}${notify ? "?notify=1" : ""}`, { method: "DELETE" }).catch(() => null);
    setWorking(undefined);
    if (!res?.ok) return setListError((await res?.json().catch(() => ({})))?.error ?? "Couldn't remove the client. Check your connection and try again.");
    const now = new Date();
    const until = new Date(now.getTime() + keepDays * 86_400_000);
    setClients((list) => list.filter((x) => x.id !== c.id));
    setSeats((s) => ({ ...s, used: s.used - 1 }));
    setRemoved((list) => [{ id: c.id, name: c.name, email: c.email, removedAt: now.toISOString(), purgeAt: until.toISOString() }, ...list]);
    setJustAdded((list) => list.filter((x) => x.id !== c.id));
    setConfirming(null);
    setNotice(`${c.name} removed. You can restore them until ${dates.longDay(until)}.`);
    // Their row (and its button) is gone: the line saying what happened takes focus instead.
    setTimeout(() => noticeLine.current?.focus(), 0);
  }

  /** Closes the Remove dialog without removing, back to the button that opened it. */
  function cancelRemove() {
    const id = confirming?.id;
    setConfirming(null);
    if (id) setTimeout(() => removeButtons.current.get(id)?.focus(), 0);
  }

  async function restore(r: Removed) {
    setWorking(r.id);
    setNotice(undefined);
    setListError(undefined);
    const res = await fetch(`/api/clients/${r.id}/restore`, { method: "POST" }).catch(() => null);
    const data = (await res?.json().catch(() => null)) ?? {};
    setWorking(undefined);
    if (!res?.ok) {
      // Already deleted, or already restored elsewhere (not a duplicate, which stays restorable once the other goes).
      if (res?.status === 404 || (res?.status === 409 && !sameEmail(r.email, r.id))) setRemoved((list) => list.filter((x) => x.id !== r.id));
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
    // Said beside the dropdown that changed.
    setAssigned({ id: c.id, text: assignedToId ? `Saved: ${staffName(assignedToId) ?? "they"} ${assignedToId === meId ? "(you) look" : "looks"} after ${c.name}` : `Saved: ${c.name} is unassigned` });
    setTimeout(() => setAssigned((cur) => (cur?.id === c.id ? undefined : cur)), 4000);
  }

  const linkOf = (c: Client) => personalLink(c.link, c.teamKeyWrap, teamKey);
  // Sent (copied, shared or emailed by the team): the badge says so, until they open it.
  const sent = (c: Client) => {
    void markLinkSent(c.id);
    setClients((list) => list.map((x) => (x.id === c.id ? { ...x, linkSent: true } : x)));
  };
  async function copy(c: Client) {
    await writeClipboard(linkOf(c));
    sent(c);
    setCopied(c.id);
    setTimeout(() => setCopied(undefined), 2000);
  }
  async function share(c: Client) {
    if (await shareLink(await linkOf(c), `${c.name}'s personal link`)) sent(c);
  }
  async function copyAll(list: Client[]) {
    await writeClipboard(Promise.all(list.map(async (c) => `${c.name}: ${await linkOf(c)}`)).then((l) => l.join("\n")));
    list.forEach(sent);
    setCopied("all");
    setTimeout(() => setCopied(undefined), 2000);
  }

  async function buySeats() {
    setError(undefined);
    setBuying("busy");
    const res = await fetch("/api/billing/seats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraSeats: extraSeats + buyQty }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.url) return void (window.location.href = data.url);
    setBuying(null);
    if (!res.ok) return setError(data.error ?? "Could not add seats");
    // Reloaded for the new totals, with a line saying it worked.
    window.location.href = `/clients?seats=${buyQty}`;
  }

  return (
    <div className="mt-8 grid gap-6">
      {/* Seats are the business's to manage: staff aren't shown how many clients the business has. */}
      {canManage && (
      <section id="buy-seats" className="scroll-mt-6 rounded-2xl border border-line bg-surface p-6">
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
        {!isOwner || (!showBuy && !extraSeats && !seatsAdded) ? null : canBuySeats ? (
          <div className="mt-5 grid gap-3 border-t border-line pt-5 text-sm" data-testid="seat-buying">
            {showBuy && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted">Need more?</span>
              <select value={buyQty} onChange={(e) => setBuyQty(Number(e.target.value))} aria-label="Extra clients" className="rounded-lg border border-line-strong bg-surface px-2 py-1.5">
                {/* Small steps too, so a business needing two more isn't made to buy five (O89). */}
                {[1, 2, 3, 5, 10, 25, 50].map((n) => <option key={n} value={n}>{plural(n, "client", "clients")}</option>)}
              </select>
              <button onClick={() => setBuying("ask")} disabled={!!buying} data-testid="buy-seats" className="rounded-lg bg-solid px-3 py-1.5 font-medium text-white hover:bg-solid-hover disabled:opacity-60">
                Add {plural(buyQty, "client", "clients")} for {money(buyQty * seatPrice)}/{per}
              </button>
            </div>
            )}
            {buying && (
              <div role="dialog" aria-label="Add client seats" data-testid="buy-seats-confirm" className="rounded-xl border border-line-strong bg-surface-2 p-4 text-muted">
                <p className="font-medium text-ink">Add {plural(buyQty, "extra client seat", "extra client seats")} for {money(buyQty * seatPrice)} a {per}, plus any tax?</p>
                <p className="mt-1">You&apos;re charged today for the rest of this billing period, then it renews with your plan.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={buySeats} disabled={buying === "busy"} className="rounded-lg bg-solid px-3 py-1.5 font-medium text-white hover:bg-solid-hover disabled:opacity-60">
                    {buying === "busy" ? "Adding…" : `Add ${plural(buyQty, "seat", "seats")}`}
                  </button>
                  <button onClick={() => setBuying(null)} disabled={buying === "busy"} className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 hover:bg-hover">Cancel</button>
                </div>
              </div>
            )}
            {!!seatsAdded && !buying && (
              <p role="status" data-testid="seats-added" className="rounded-lg border border-ok-line bg-ok-bg px-3 py-2 text-ok-fg">
                Added {plural(seatsAdded, "client seat", "client seats")}. You can add {plural(left, "more client", "more clients")} now. Your receipt comes by email from Link, Stripe&apos;s payment service, and Settings &gt; Billing shows what you pay.
              </p>
            )}
            {/* Lowering bought seats is billing, on its own row away from removing a client. */}
            <RemoveExtras extra={extraSeats} spare={seats.limit - seats.used} noun={{ one: "client seat", many: "client seats", holder: "clients" }} endpoint="/api/billing/seats" field="extraSeats" onError={setError} />
            {showBuy && suggestStudio && (
              <p data-testid="studio-hint" className="rounded-lg bg-primary-soft px-3 py-2 text-ink">
                That would bring Solo to {money(soloAfter)}/month. Studio is {money(studioHint.studioPrice)}/month with {studioHint.studioClients} clients and 3 staff logins (yours included).{" "}
                <Link href="/pricing" className="font-medium underline">See plans</Link>
              </p>
            )}
          </div>
        ) : !showBuy ? null : complimentary ? (
          <p className="mt-5 border-t border-line pt-5 text-sm text-muted" data-testid="comp-seats-note">
            Extra clients can be added once you start a paid subscription. <Link href="/pricing" className="font-medium text-accent hover:underline">Choose a paid plan</Link>
          </p>
        ) : (
          <p className="mt-5 border-t border-line pt-5 text-sm text-muted">
            <Link href="/pricing" className="font-medium text-accent hover:underline">Upgrade</Link> for 10 or more clients, with extra clients at {money(seatPrice)} each per month.
          </p>
        )}
      </section>
      )}

      {canAdd && (
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="font-semibold text-ink">{canManage ? "Add a client" : "Add a client of your own"}</h2>
        {!canManage && <p className="mt-1 text-sm text-dim">Clients you add are assigned to you. The owner or an admin can also assign clients to you.</p>}
        {/* The steps only until the first client is added. */}
        {clients.length === 0 && (
          <div className="mt-3" data-testid="first-link-rule">
            <PersonalLinkSteps />
          </div>
        )}
        <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Name" aria-label="Client name" className="min-w-0 rounded-lg border border-line-strong px-3 py-2 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email (optional)" aria-label="Client email" className="min-w-0 rounded-lg border border-line-strong px-3 py-2 text-sm" />
          <button disabled={busy || full || !!activeMatch} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
            Add client
          </button>
        </form>
        {activeMatch && (
          <p className="mt-2 text-sm text-warn-fg" data-testid="duplicate-match">
            {activeMatch.email ? `${activeMatch.name} already uses this email, so they're on your list.` : `You already have a client called ${activeMatch.name} with no email. Add an email to tell them apart.`}{" "}
            <Link href={`/clients/${activeMatch.id}`} className="font-medium text-accent hover:underline">Open {activeMatch.name}</Link>
          </p>
        )}
        {justAdded.length > 0 && (
          <div ref={addedNote} role="status" data-testid="added-note" className="mt-3 rounded-xl border border-line bg-surface-2 p-4 text-sm text-ink">
            <p className="text-ok-fg">
              {justAdded.length === 1 ? `${justAdded[0].name} added.` : `Added ${plural(justAdded.length, "client", "clients")}.`}{" "}
              {unfit.length > 0 && (
                <span data-testid="bulk-unfit">
                  {plural(unfit.length, "client", "clients")} didn&apos;t fit in your seats ({unfit.slice(0, 5).join(", ")}{unfit.length > 5 ? "…" : ""}), so {unfit.length === 1 ? "it's" : "they're"} still in the box below.{" "}
                  {isOwner ? <a href={buyHref} className="font-medium underline">{canBuySeats ? "Add seats" : "See plans with more seats"}</a> : "Ask the owner to add seats"}.{" "}
                </span>
              )}
              {unread.length > 0 && (
                <span data-testid="bulk-unread" className="font-medium">
                  {unread.length === 1 ? "1 line wasn't added" : `${unread.length} lines weren't added`} because we couldn&apos;t read a name and email in {unread.length === 1 ? "it" : "them"}, so {unread.length === 1 ? "it's" : "they're"} still in the box below to fix.
                </span>
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3" data-testid="added-next">
              <Link href="/record" className="rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover" data-testid="added-record">
                Record a video for {justAdded.length === 1 ? justAdded[0].name : "them"}
              </Link>
            </div>
            {/* Their own link (no video yet) is still there for anyone who wants it, out of the way. */}
            <details className="mt-3" data-testid="added-links">
              <summary className="cursor-pointer text-xs font-medium text-dim hover:text-ink">Or send {justAdded.length === 1 ? "their" : "each one their"} link now</summary>
              {justAdded.length === 1 ? (
                <div className="mt-2">
                  <FirstLinkSender plain name={justAdded[0].name} email={justAdded[0].email} business={business} getLink={() => linkOf(justAdded[0])} onSent={() => sent(justAdded[0])} copyLabel="Copy link" />
                </div>
              ) : (
                <>
                  <ul className="mt-2 grid max-h-96 gap-3 overflow-y-auto" data-testid="added-list">
                    {justAdded.map((c) => (
                      <li key={c.id} className="rounded-lg bg-surface p-3">
                        <p className="mb-1.5 break-words font-medium">{c.name}</p>
                        <FirstLinkSender compact plain name={c.name} email={c.email} business={business} getLink={() => linkOf(c)} onSent={() => sent(c)} copyLabel="Copy link" />
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => copyAll(justAdded)} data-testid="added-copy-all" className="mt-3 rounded-lg border border-line-strong bg-surface px-3 py-1.5 hover:bg-hover">
                    {copied === "all" ? "Copied" : `Copy all ${justAdded.length} links as a list`}
                  </button>
                </>
              )}
            </details>
            <button
              type="button"
              onClick={() => {
                const many = justAdded.length > 1;
                setJustAdded([]);
                setUnfit([]);
                setUnread([]);
                // After a pasted list, the new clients are in the list below: take the page there.
                if (many) listTop.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
              }}
              data-testid="added-done"
              className="mt-3 rounded-lg border border-line-strong bg-surface px-4 py-1.5 font-medium text-ink hover:bg-hover"
            >
              Done
            </button>
          </div>
        )}
        {bulk === null ? (
          <button type="button" onClick={() => setBulk("")} className="mt-3 text-sm font-medium text-accent hover:underline" data-testid="bulk-open">
            Add several at once
          </button>
        ) : (
          <div className="mt-4 grid gap-2 border-t border-line pt-4" data-testid="bulk-add">
            <label htmlFor="bulk-list" className="text-sm font-medium text-ink">Paste your client list</label>
            <p className="text-xs text-dim">One client per line: a name and email (&ldquo;Client A, client-a@example.com&rdquo;), just an email, or copy the name and email columns straight from a spreadsheet.</p>
            <textarea
              id="bulk-list"
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              rows={6}
              placeholder={"Client A, client-a@example.com\nclient-b@example.com"}
              className="min-w-0 rounded-lg border border-line-strong px-3 py-2 font-mono text-sm"
            />
            {parsed && (parsed.clients.length > 0 || parsed.bad.length > 0) && (
              <p className="text-sm text-muted" data-testid="bulk-summary">
                {plural(fresh.length, "client", "clients")} ready to add
                {fresh.length > left && ` (${left === 0 ? "no seats left" : `only ${plural(left, "seat", "seats")} left`})`}
                {dupes > 0 && `, ${dupes} already on your list`}.
              </p>
            )}
            {parsed && parsed.bad.length > 0 && (
              <div className="rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-fg" data-testid="bulk-bad">
                <p>
                  {parsed.bad.length === 1 ? "This line won't be added" : `These ${parsed.bad.length} lines won't be added`} until it&apos;s fixed. Put a comma between the name and email, like &ldquo;Client A, client-a@example.com&rdquo;:
                </p>
                <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                  {parsed.bad.slice(0, 5).map((l, i) => <li key={i} className="break-all">{l}</li>)}
                  {parsed.bad.length > 5 && <li>and {parsed.bad.length - 5} more</li>}
                </ul>
              </div>
            )}
            {fresh.length > left && (
              <p className="text-sm text-warn-fg" data-testid="bulk-over">
                {left > 0 ? `The first ${plural(left, "client", "clients")} will be added and the rest stay here for later. ` : ""}
                {isOwner ? (
                  <a href={buyHref} className="font-medium text-accent hover:underline">{canBuySeats ? "Add seats" : "See plans with more seats"}</a>
                ) : (
                  "Ask the owner to add seats."
                )}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={addMany} disabled={busy || !fits.length} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
                {busy ? "Adding…" : fresh.length > fits.length && fits.length ? `Add the ${plural(fits.length, "client", "clients")} that fit` : `Add ${fits.length || ""} ${fits.length === 1 ? "client" : "clients"}`}
              </button>
              <button type="button" onClick={() => { setBulk(null); setUnfit([]); setUnread([]); }} className="rounded-lg px-3 py-2 text-sm text-dim hover:text-ink">Cancel</button>
            </div>
          </div>
        )}
        {removedMatch && (
          <p className="mt-2 text-sm text-muted" data-testid="removed-match">
            {removedMatch.name} was removed on {dates.day(new Date(removedMatch.removedAt))}. Restore them instead to keep their history.{" "}
            <button type="button" onClick={() => restore(removedMatch)} disabled={full || working === removedMatch.id} className="font-medium text-accent hover:underline disabled:opacity-50">
              Restore {removedMatch.name}
            </button>
          </p>
        )}
        {full && !(bulk !== null && fresh.length > left) && (
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

      {(notice || (listError && !confirming)) && (
        <p ref={noticeLine} tabIndex={-1} role={listError ? "alert" : "status"} data-testid="clients-notice" className={`rounded-xl border p-3 text-sm ${listError ? "border-danger-line bg-danger-bg text-danger-fg" : "border-ok-line bg-ok-bg text-ok-fg"}`}>
          {listError ?? notice}
        </p>
      )}

      <section ref={listTop} className="scroll-mt-6 rounded-2xl border border-line bg-surface">
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
        {clients.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3 sm:px-6">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email"
              aria-label="Search clients"
              data-testid="clients-search"
              className="min-w-0 flex-1 basis-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm"
            />
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Show" data-testid="clients-filter" className="min-w-0 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm">
              <option value="all">All</option>
              <option value="first">Not opened a video yet{waiting ? ` (${waiting})` : ""}</option>
              <option value="no-email">No email</option>
              {clients.some((c) => c.paused || c.linkOff) && <option value="paused">Paused or link off</option>}
            </select>
          </div>
        )}
        {shown.length === 0 ? (
          <p className="p-6 text-sm text-dim">
            {clients.length === 0 && seesAll ? "No clients yet." : inTab.length === 0 ? "No clients are assigned to you yet." : "No clients match."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((c) => {
              const twin = sameEmail(c.email, c.id);
              return (
                <li key={c.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-center sm:px-6">
                  <div className="min-w-0">
                    <Link href={`/clients/${c.id}`} className="break-words font-medium text-ink hover:text-accent hover:underline">{c.name}</Link>{" "}
                    {!c.reached && !c.linkOff && <LinkBadge sent={c.linkSent} />}
                    {c.paused && (
                      <span className="ml-1 rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn-fg" data-testid="client-paused-badge" title="Over your plan's client limit">
                        Paused
                      </span>
                    )}
                    {c.linkOff && (
                      <span className="ml-1 rounded-full bg-danger-bg px-2 py-0.5 text-xs font-semibold text-danger-fg" data-testid="client-link-off-badge" title="Turned off by SureFrame support">
                        Link off
                      </span>
                    )}
                    <p className="break-words text-xs text-dim">
                      {c.email && <><span className="break-all">{c.email}</span> · </>}{plural(c.videoCount, "video", "videos")}
                      {staff.length > 1 && seesAll && !canManage && ` · ${staffName(c.assignedToId) ?? "Unassigned"}`}
                    </p>
                    {/* After a key reset an old link no longer opens: a reminder for anyone who saved it in a draft. */}
                    {c.replaced && !c.linkOff && (
                      <p className="text-xs text-warn-fg" data-testid="link-replaced">
                        Link replaced on {dates.shortDay(new Date(c.replaced.at))}
                        {c.replaced.emailed ? ": we emailed them the new one." : ": the old one no longer works, so send them the new one (Copy link)."}
                      </p>
                    )}
                    {/* Replies waiting, so they aren't only found on the library's cards. */}
                    {!!c.convs?.length && (
                      <Link href={`/clients/${c.id}`} className="mt-1 block w-fit empty:hidden" aria-label={`Replies from ${c.name}`}>
                        <ReplyBadges convs={c.convs} />
                      </Link>
                    )}
                  </div>
                  {/* Every row's controls sit on the right, the same size, wrapping from the right when there's no room. */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs sm:justify-end" data-testid="client-row-actions">
                    {staff.length > 1 && canManage && (
                      <select aria-label={`Who looks after ${c.name}`} value={c.assignedToId ?? ""} onChange={(e) => assign(c, e.target.value || null)}
                        className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs">
                        <option value="">Unassigned (owner and admins)</option>
                        {staff.map((p) => <option key={p.id} value={p.id}>{p.id === meId ? `${p.name} (you)` : p.name}</option>)}
                      </select>
                    )}
                    {assigned?.id === c.id && <span role="status" className="self-center text-xs text-ok-fg" data-testid="assign-saved">{assigned.text}</span>}
                    {/* New clients are set up by their first video's link, sent from its Send box, so their own link is no more urgent than anyone's. */}
                    {!c.linkOff && (
                      <>
                        <button onClick={() => copy(c)} aria-label={`Copy link for ${c.name}`} className="rounded-lg border border-line-strong bg-surface px-2.5 py-1 font-medium text-ink hover:bg-hover">
                          {copied === c.id ? "Copied" : "Copy link"}
                        </button>
                        {canShare && <button onClick={() => share(c)} aria-label={`Share personal link for ${c.name}`} className="rounded-lg border border-line-strong bg-surface px-2.5 py-1 font-medium text-ink hover:bg-hover">Share</button>}
                      </>
                    )}
                    {canManage && (
                      <button
                        ref={(el) => {
                          if (el) removeButtons.current.set(c.id, el);
                          else removeButtons.current.delete(c.id);
                        }}
                        onClick={() => askRemove(c)}
                        aria-label={`Remove client ${c.name}`}
                        aria-haspopup="dialog"
                        className="rounded-lg px-2.5 py-1 font-medium text-dim hover:bg-hover hover:text-danger-fg"
                      >
                        Remove client
                      </button>
                    )}
                  </div>
                  {/* The same dialog as Billing's: focus moves in, Escape or the background closes it, focus goes back to Remove client. */}
                  {confirming?.id === c.id && (
                    <DialogShell title={`Remove ${c.name}?`} onClose={working === c.id ? undefined : cancelRemove} testId="remove-client-confirm">
                      <div className="mt-3 space-y-2 text-sm text-muted">
                        <p>Their personal link stops working now and their seat is freed.</p>
                        <p>You can restore them from Removed clients on this page until {dates.longDay(confirming.until)}.</p>
                        {/* The detail is there for whoever wants it, not three paragraphs every time. */}
                        <details data-testid="remove-client-details">
                          <summary className="cursor-pointer font-medium text-accent hover:underline">What happens to their data?</summary>
                          <ul className="mt-2 list-disc space-y-1 pl-5">
                            <li>Their videos, conversations, to-dos and notes are kept until {dates.longDay(confirming.until)}, so you can restore them from Removed clients.</li>
                            {!cloudBackup && <li>Recordings without cloud backup still leave our servers on their usual dates, and restoring doesn&apos;t bring those back.</li>}
                            <li>After that they&apos;re deleted for good, including your team&apos;s replies to them, even with cloud backup on.</li>
                            <li>Recordings you also sent to other clients stay with those clients.</li>
                          </ul>
                        </details>
                        {c.email && twin ? (
                          <p data-testid="remove-client-twin">{twin.name} also uses {c.email}, so nobody is emailed about this.</p>
                        ) : c.email ? (
                          <label className="flex items-center gap-2 text-ink">
                            <input type="checkbox" checked={tellClient} onChange={(e) => setTellClient(e.target.checked)} data-testid="remove-client-email" />
                            Email {c.name} that their access has ended
                          </label>
                        ) : null}
                      </div>
                      {listError && (
                        <p role="alert" className="mt-3 rounded-xl border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg">
                          {listError}
                        </p>
                      )}
                      <DialogButtons>
                        <button onClick={() => remove(c)} disabled={working === c.id} className={dangerButton} data-testid="remove-client-yes">
                          {working === c.id ? "Removing…" : `Remove ${c.name}`}
                        </button>
                        <button onClick={cancelRemove} disabled={working === c.id} className={quietButton}>
                          Cancel
                        </button>
                      </DialogButtons>
                    </DialogShell>
                  )}
                </li>
              );
            })}
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
            {removed.map((r) => {
              const twin = sameEmail(r.email, r.id);
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-ink">{r.name}</p>
                    <p className="break-words text-xs text-dim">
                      {r.email && <><span className="break-all">{r.email}</span> · </>}Removed {dates.day(new Date(r.removedAt))}
                      {/* A date is enough here; the time and zone were noise (O24). */}
                      {r.purgeAt && ` · deleted for good on ${dates.day(new Date(r.purgeAt))}`}
                    </p>
                    {twin && <p className="text-xs text-warn-fg" data-testid="restore-duplicate">{twin.name} uses this email now, so they can&apos;t both be on your list.</p>}
                  </div>
                  <button
                    onClick={() => restore(r)}
                    disabled={full || !!twin || working === r.id}
                    title={full ? "Free a seat or add seats to restore" : undefined}
                    aria-label={`Restore ${r.name}`}
                    data-testid="restore-client"
                    className="rounded-lg border border-line-strong px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-50"
                  >
                    {working === r.id ? "Restoring…" : "Restore"}
                  </button>
                </li>
              );
            })}
          </ul>
          {full && <p className="px-6 pb-4 text-xs text-warn-fg">All client seats are in use. Free a seat or add seats to restore someone.</p>}
        </section>
      )}
    </div>
  );
}

/** A client who hasn't opened a video yet: new (nothing sent yet), or sent one and not opened it. */
export function LinkBadge({ sent }: { sent?: boolean }) {
  return sent ? (
    <span className="ml-1 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-dim" data-testid="needs-first-link" title="You've sent them a link, and they haven't opened it yet. Once they do, we can email them your videos.">
      Not opened yet
    </span>
  ) : (
    <span className="ml-1 inline-block rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-accent" data-testid="needs-first-link" title="Their first video comes from you, by your own email, texts or chat. After that we can email them.">
      New
    </span>
  );
}
