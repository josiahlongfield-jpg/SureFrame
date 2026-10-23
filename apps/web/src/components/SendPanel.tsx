"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { fingerprint, generateKey, unwrapKey, wrapKey } from "@/lib/e2e/crypto";
import { writeClipboard } from "@/lib/clipboard";
import { isDefaultTitle } from "@/lib/videoTitle";
import { LinkBadge, markLinkSent, personalLink } from "./ClientsManager";
import FirstLinkSender from "./FirstLinkSender";
import RouteChoice, { routeLine, routeOf, type Route } from "./SendRoute";
import { useTitleSaver } from "./useTitleSaver";
import type { ClientOption, SendMany } from "./WatchView";

/** A client this recording went to, and their conversation about it (this video, or their own copy); `opened` once they've watched it. */
type Recipient = { clientId: string; convId: string; opened?: boolean };
type RowState = "emailed" | "when-ready" | "copied" | "own-email";

/**
 * A client is reached once they've opened a link with their key on a device
 * (their first video's link, or their personal link). Until then an email from
 * us can't open for them, so the business sends that first video's link itself;
 * copying or sending it doesn't count, only their opening it.
 */
const reached = (c: ClientOption) => !!c.hasLink;
const canEmail = (c: ClientOption) => reached(c) && !!c.emailable;

/**
 * Which part of the Send box a client's row sits in (Josiah, 23 October 2026): a first video always comes from the
 * business; after that, clients set to Email are emailed and the rest are listed with Copy link. A client who turned
 * our emails off is listed with Copy link too.
 */
type Section = "email" | "link" | "first";
const sectionOf = (c: ClientOption): Section => (!reached(c) ? "first" : c.email && !c.emailsOff ? "email" : "link");

const btn = "rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-xs hover:bg-hover disabled:opacity-50";

/**
 * Sending a recording: choose one client or several, then one Send button. Each client gets it the way chosen when
 * they were added: we email those set to Email, those set to Copy link are listed with their own link to copy, and a
 * client's first video goes from the business (its link sets them up on their device). Each client gets their own
 * private conversation; nobody sees anyone else's replies.
 */
export default function SendPanel({
  video,
  clients: given,
  business,
  canAddClient,
  sentToId,
  sendMany,
  hasReplies,
  rootKey,
  teamKey,
  onTitle,
}: {
  video: { id: string; title: string; status: string; encrypted: boolean; sourceId: string | null; viewCount?: number; emailed?: "sent" | "when-ready" | null };
  clients: ClientOption[];
  /** The business's name, signed at the end of the message sent with a personal link. */
  business: string;
  /** May add a new client from here (lib/permissions.ts addClients). */
  canAddClient?: boolean;
  sentToId: string | null;
  /** Set when this person may send one recording to several clients. */
  sendMany?: SendMany;
  hasReplies: boolean;
  rootKey: CryptoKey;
  teamKey: CryptoKey;
  /** A title given in the Send box, so the page heading shows it too. */
  onTitle?: (title: string) => void;
}) {
  const router = useRouter();
  // Clients added from this box, until the page's own list has them.
  const [extra, setExtra] = useState<ClientOption[]>([]);
  const clients = useMemo(() => [...given, ...extra.filter((e) => !given.some((c) => c.id === e.id))], [given, extra]);
  const [adding, setAdding] = useState(false);
  const isCopy = !!video.sourceId;
  const uploading = video.status === "RECORDING";
  const [primary, setPrimaryState] = useState(sentToId);
  // Read by sends already under way: two quick clicks mustn't both give the video itself to a client.
  const primaryRef = useRef(sentToId);
  const setPrimary = (id: string | null) => {
    primaryRef.current = id;
    setPrimaryState(id);
  };
  const [recipients, setRecipients] = useState<Recipient[]>(() => [
    ...(sentToId ? [{ clientId: sentToId, convId: video.id, opened: (video.viewCount ?? 0) > 0 }] : []),
    ...(sendMany?.copies ?? []).map((c) => ({ clientId: c.clientId, convId: c.id, opened: c.opened })),
  ]);
  // What's been done for each client: emailed by us (kept on the video, so it's still said after a reload), or sent by the business.
  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const out: Record<string, RowState> = {};
    if (sentToId && video.emailed) out[sentToId] = video.emailed === "sent" ? "emailed" : "when-ready";
    for (const c of sendMany?.copies ?? []) if (c.emailed) out[c.clientId] = "emailed";
    return out;
  });
  // The confirmation line under a client's own row.
  const [rowNotes, setRowNotes] = useState<Record<string, { text: string; fallback?: boolean; error?: boolean }>>({});
  // Always starts with nobody chosen: a remembered client would need taking off every time it's for someone else
  // (Josiah, 23 October 2026).
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean }>();
  const [stopping, setStopping] = useState<string | null>(null);
  // Named in this box: it says so, though the title is no longer the default.
  const [titled, setTitled] = useState(false);
  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const has = new Set(recipients.map((r) => r.clientId));
  // Who can be chosen: active clients with a key, who don't have it yet.
  const available = clients.filter((c) => c.link && c.teamKeyWrap && !c.removed && !c.paused && !c.linkOff && !has.has(c.id));
  // Several clients at once needs the permission, and the upload to have finished.
  const many = !!sendMany && !uploading && video.encrypted;
  const canPick = !isCopy && (many || !primary);
  const shown = search.trim() ? available.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase())) : available;
  const team = (sendMany?.staff.length ?? 0) > 1;
  const chosen = picked.map((id) => byId.get(id)!).filter(Boolean);

  // Each recipient's personal link for their conversation, worked out ahead so Copy link works in one tap.
  const [links, setLinks] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, string> = {};
      for (const r of recipients) {
        const c = byId.get(r.clientId);
        if (!c?.link) continue;
        out[r.convId] = await linkFor(c, r.convId);
      }
      if (!cancelled) setLinks(out);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipients, byId, teamKey]);

  async function linkFor(c: ClientOption, convId: string) {
    const url = new URL(c.link);
    url.searchParams.set("v", convId);
    return personalLink(url.toString(), c.teamKeyWrap, teamKey);
  }

  // The dropdown closes when you click or tab away from it.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("focusin", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("focusin", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  function toggle(id: string) {
    if (!many) {
      setPicked((cur) => (cur[0] === id ? [] : [id]));
      setOpen(false);
      return;
    }
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }
  const pickAll = (ids: string[]) => setPicked(ids.filter((id) => available.some((c) => c.id === id)));

  /** Gives each chosen client this recording, emailing those set to Email who can open it from an email. */
  async function deliver(list: ClientOption[]) {
    const wrapFor = async (c: ClientOption) => (c.teamKeyWrap ? wrapKey(rootKey, await unwrapKey(c.teamKeyWrap, teamKey)) : undefined);
    const keyFingerprint = await fingerprint(teamKey);
    const added: Recipient[] = [];
    const states: Record<string, RowState> = {};
    let rest = list;
    const first = !primaryRef.current;
    if (first && list.length) {
      // The first client gets this video itself.
      const c = list[0];
      rest = list.slice(1);
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: c.id, clientKeyWrap: await wrapFor(c), keyFingerprint, notify: canEmail(c) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't send it to ${c.name}. Try again.`);
      setPrimary(c.id);
      added.push({ clientId: c.id, convId: video.id });
      if (data.emailed) states[c.id] = data.emailed === "when-ready" ? "when-ready" : "emailed";
    }
    // Everyone else gets their own copy: one request for those we email, one for the rest.
    for (const notify of [true, false]) {
      const group = rest.filter((c) => canEmail(c) === notify);
      if (!group.length) continue;
      const res = await fetch(`/api/videos/${video.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: await Promise.all(group.map(async (c) => ({ clientId: c.id, clientKeyWrap: await wrapFor(c) }))), notify, keyFingerprint }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't send it. Try again.");
      const sent = data.sent as { id: string; clientId: string; emailed?: boolean }[];
      added.push(...sent.map((s) => ({ clientId: s.clientId, convId: s.id })));
      for (const s of sent) if (s.emailed) states[s.clientId] = "emailed";
    }
    setRecipients((cur) => [...cur, ...added]);
    setRows((cur) => ({ ...cur, ...states }));
    // The rest of the page (the conversation panel, and its list of every client's conversation) shows who this video is with.
    if (added.length) router.refresh();
    setPicked((cur) => cur.filter((id) => !list.some((c) => c.id === id)));
    return added;
  }

  /**
   * The one Send button, for one client or several (Josiah, 23 October 2026): everyone chosen gets the video, those
   * set to Email are emailed now, and the sections below list who has a link to copy or a first video to send.
   */
  async function send() {
    setBusy("send");
    setNote(undefined);
    try {
      await deliver(chosen);
    } catch (err) {
      setNote({ text: (err as Error).message || "Couldn't send it. Try again.", error: true });
    } finally {
      setBusy(null);
    }
  }

  /** Drops a row's line, e.g. an earlier "Couldn't copy", once "Link copied" says it all. */
  function clearRowNote(id: string) {
    setRowNotes((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }

  /** After a first video's link went out from the business: said under that client's own row. */
  function firstSent(c: ClientOption, how: "link" | "message" | "share" | "email") {
    void markLinkSent(c.id);
    setRows((cur) => ({ ...cur, [c.id]: how === "email" ? "own-email" : "copied" }));
    // A copy needs no line of its own: the row already says "Link copied" (Josiah, 23 October 2026).
    if (how === "email") setRowNotes((cur) => ({ ...cur, [c.id]: { text: `Your email app should open with ${c.name}'s video and personal link, ready to send.`, fallback: true } }));
    else clearRowNote(c.id);
  }

  /** A client added from this box: chosen straight away, ready for Send. */
  function quickAdded(c: ClientOption, route: Route) {
    setExtra((cur) => [...cur, c]);
    setPicked((cur) => (many ? [...cur, c.id] : [c.id]));
    setAdding(false);
    setNote({ text: routeLine(c.name, route) });
  }

  async function copyRow(r: Recipient) {
    const c = byId.get(r.clientId);
    const link = links[r.convId];
    if (!link || !c) return;
    try {
      await writeClipboard(link);
    } catch {
      return setRowNotes((cur) => ({ ...cur, [c.id]: { text: "Couldn't copy the link. Try again.", error: true } }));
    }
    void markLinkSent(r.clientId);
    setRows((cur) => ({ ...cur, [r.clientId]: "copied" }));
    clearRowNote(c.id);
  }

  async function emailRow(r: Recipient) {
    const c = byId.get(r.clientId);
    setBusy(`email:${r.convId}`);
    const res = await fetch(`/api/videos/${r.convId}/notify`, { method: "POST" }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setBusy(null);
    if (!res?.ok) return setRowNotes((cur) => ({ ...cur, [r.clientId]: { text: data?.error ?? "Couldn't send it. Try again.", error: true } }));
    setRows((cur) => ({ ...cur, [r.clientId]: data.emailed === "when-ready" ? "when-ready" : "emailed" }));
    setRowNotes((cur) => ({ ...cur, [r.clientId]: { text: data.emailed === "when-ready" ? `We'll email ${c?.name ?? "them"} once the upload finishes.` : `Emailed ${c?.name ?? "them"} again.` } }));
  }

  /** Stop sharing: the client's link no longer opens this. Their own copy (and its conversation) is deleted; this video itself goes back to the team. */
  async function stopSharing(r: Recipient) {
    const c = byId.get(r.clientId);
    setBusy(`stop:${r.convId}`);
    setNote(undefined);
    const own = r.convId === video.id && !isCopy;
    const res = await (own
      ? fetch(`/api/videos/${video.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: null, keyFingerprint: await fingerprint(teamKey) }),
        })
      : fetch(`/api/videos/${r.convId}`, { method: "DELETE" })
    ).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setNote({ text: (await res?.json().catch(() => ({})))?.error ?? "Couldn't stop sharing. Try again.", error: true });
    setStopping(null);
    // This page was their own copy: it's gone, so go back to the recording.
    if (r.convId === video.id && isCopy) return void (window.location.href = `/v/${video.sourceId}`);
    setRecipients((cur) => cur.filter((x) => x.convId !== r.convId));
    setRows((cur) => {
      const next = { ...cur };
      delete next[r.clientId];
      return next;
    });
    setRowNotes((cur) => {
      const next = { ...cur };
      delete next[r.clientId];
      return next;
    });
    if (own) setPrimary(null);
    // Their conversation leaves the list beside the video.
    router.refresh();
    setNote({ text: `${c?.name ?? "That client"} can no longer open this video.` });
  }

  const label = picked.length === 0 ? (many ? "Choose clients" : "Choose a client") : picked.length === 1 ? byId.get(picked[0])?.name : `${picked.length} clients chosen`;
  const isBlocked = (c: ClientOption) => !!(c.removed || c.paused || c.linkOff || !c.link);
  const sentLink = (c: ClientOption) => c.linkSent || rows[c.id] === "copied" || rows[c.id] === "own-email";
  const sent = recipients.filter((r) => byId.has(r.clientId));
  const inSection = (s: Section) => sent.filter((r) => sectionOf(byId.get(r.clientId)!) === s);
  const emailRows = inSection("email");
  const linkRows = inSection("link");
  const firstRows = inSection("first");

  /** Asks before taking this video away from a client. */
  const stopBox = (r: Recipient) => {
    const c = byId.get(r.clientId)!;
    const own = r.convId === video.id && !isCopy;
    return (
      <div role="dialog" aria-label={`Stop sharing with ${c.name}`} data-testid="stop-sharing-confirm" className="mt-2 rounded-lg border border-danger-line bg-danger-bg p-3 text-xs text-muted">
        {own && hasReplies ? (
          <>
            <p className="font-medium text-ink">{c.name} has already replied, so this video stays with them.</p>
            <p className="mt-1">Their replies belong to this conversation. To take the video away, delete it above, which removes it for everyone it was sent to.</p>
            <div className="mt-2">
              <button onClick={() => setStopping(null)} className={btn}>Close</button>
            </div>
          </>
        ) : (
          <>
            <p className="font-medium text-ink">Stop sharing this video with {c.name}?</p>
            <p className="mt-1">
              {own
                ? `Their link stops opening it straight away. Any email we sent them no longer opens it either.`
                : `Their link stops opening it straight away, and their conversation about it, including any replies, is deleted. This can't be undone.`}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => stopSharing(r)} disabled={busy === `stop:${r.convId}`} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                Stop sharing with {c.name}
              </button>
              <button onClick={() => setStopping(null)} className={btn}>Cancel</button>
            </div>
          </>
        )}
      </div>
    );
  };

  // Adding a client from the Send box: under the picker, and when everyone already has the video (O42).
  const addControl = canAddClient ? (
    adding ? (
      <QuickAddClient teamKey={teamKey} onAdded={quickAdded} onCancel={() => setAdding(false)} />
    ) : (
      <button type="button" onClick={() => setAdding(true)} className="mt-2 text-sm font-medium text-accent hover:underline" data-testid="quick-add-open">
        + Add a new client
      </button>
    )
  ) : null;

  /** One client's row in a section: their name, what's happened, the section's buttons, and Stop sharing behind a confirm. */
  const row = (r: Recipient, section: Section) => {
    const c = byId.get(r.clientId)!;
    const blocked = isBlocked(c);
    const state = rows[r.clientId];
    const rowNote = rowNotes[r.clientId];
    const status =
      section === "email"
        ? state === "emailed" ? "Emailed" : state === "when-ready" ? "Emailed when the upload finishes" : "Not emailed yet"
        : state === "own-email" ? "Sent from your email" : state === "copied" ? "Link copied" : section === "first" && !sentLink(c) ? "Not sent yet" : null;
    return (
      <li key={r.convId} className="py-2 text-sm first:pt-0 last:pb-0" data-testid="sent-row" data-section={section}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 break-words">
            {r.convId === video.id ? <span className="font-medium text-ink" data-testid="row-name">{c.name}</span> : (
              <Link href={`/v/${r.convId}`} className="font-medium text-ink hover:text-accent hover:underline" data-testid="row-name">{c.name}</Link>
            )}
            {section === "link" && c.emailsOff && (
              <span className="ml-2 text-xs text-dim" data-testid="emails-off">Emails turned off by client</span>
            )}
            {!blocked && status && (
              <span className={`ml-2 text-xs ${state ? "text-ok-fg" : "text-dim"}`} data-testid="row-state">{status}</span>
            )}
            {!blocked && (
              // Whether they've watched it yet.
              <span className={`ml-2 text-xs ${r.opened ? "text-ok-fg" : "text-dim"}`} data-testid="row-opened">
                {r.opened ? "· Opened" : "· Not opened yet"}
              </span>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {!blocked && section === "first" && (
              <FirstLinkSender compact inline video only={routeOf(c)} name={c.name} email={c.email} business={business} disabled={!links[r.convId]} getLink={async () => links[r.convId]} onSent={(how) => firstSent(c, how)} />
            )}
            {!blocked && section === "email" && (
              <button onClick={() => emailRow(r)} disabled={busy === `email:${r.convId}`} data-testid="email-row" className={btn}>
                {state === "emailed" || state === "when-ready" ? "Send again" : "Send by email"}
              </button>
            )}
            {!blocked && section === "link" && (
              <button onClick={() => copyRow(r)} disabled={!links[r.convId]} data-testid="copy-row-link" className={btn}>
                Copy link
              </button>
            )}
            {!c.removed && (
              <button onClick={() => setStopping(stopping === r.convId ? null : r.convId)} data-testid="stop-sharing" className="rounded-lg px-2 py-1 text-xs text-dim hover:text-danger-fg">
                Stop sharing
              </button>
            )}
          </span>
        </div>
        {c.removed ? (
          <p className="mt-1 text-xs text-warn-fg">{c.name} was removed from your clients, so their link no longer opens this.</p>
        ) : c.linkOff ? (
          <p className="mt-1 text-xs text-warn-fg">SureFrame support turned off {c.name}&apos;s link, so they can&apos;t open this. Contact support@sureframe.app.</p>
        ) : c.paused ? (
          <p className="mt-1 text-xs text-warn-fg">{c.name} is paused because your plan covers fewer clients, so they can&apos;t open this until they&apos;re restored.</p>
        ) : null}
        {rowNote && (
          <p role={rowNote.error ? "alert" : "status"} className={`mt-1 text-xs ${rowNote.error ? "text-danger-fg" : "text-ok-fg"}`} data-testid="row-note">
            {rowNote.text}
            {rowNote.fallback && (
              <>
                {" "}
                <span className="text-dim">Nothing opened?</span>{" "}
                <button type="button" onClick={() => copyFirst(r)} className="font-medium text-accent hover:underline" data-testid="copy-instead">
                  Copy the link instead
                </button>
              </>
            )}
          </p>
        )}
        {stopping === r.convId && stopBox(r)}
      </li>
    );
  };

  /** "Nothing opened?" after Send from your email: their link onto the clipboard, to paste into an email by hand. */
  async function copyFirst(r: Recipient) {
    const c = byId.get(r.clientId);
    const link = links[r.convId];
    if (!link || !c) return;
    try {
      await writeClipboard(link);
    } catch {
      return setRowNotes((cur) => ({ ...cur, [c.id]: { text: "Couldn't copy the link. Try again.", error: true } }));
    }
    setRows((cur) => ({ ...cur, [c.id]: "copied" }));
    clearRowNote(c.id);
  }

  /** A section of sent clients, each with its own heading (Josiah's names for them). */
  const section = (id: Section, title: string, list: Recipient[], intro?: React.ReactNode) =>
    list.length > 0 && (
      <section className="mt-3 rounded-xl bg-surface-2 p-3" data-testid={`sec-${id}`}>
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        {intro}
        <ul className="mt-2 divide-y divide-line">{list.map((r) => row(r, id))}</ul>
      </section>
    );

  const firstNames = firstRows.map((r) => byId.get(r.clientId)!.name);

  return (
    <div className="mt-5 rounded-2xl border border-line bg-surface p-4" data-testid="send-panel">
      {isCopy && (
        <p className="mb-3 text-sm text-muted">
          This is {byId.get(primary ?? "")?.name ?? "a client"}&apos;s own conversation about this recording.{" "}
          <Link href={`/v/${video.sourceId}`} className="font-medium text-accent hover:underline">See the original</Link>
        </p>
      )}

      {canPick && (
        <>
          <h2 className="font-medium text-ink">{recipients.length ? "Send to more clients" : "Send this video"}</h2>
          {!uploading && clients.length > 0 && (isDefaultTitle(video.title) || titled) && (
            <TitlePrompt
              videoId={video.id}
              business={business}
              onTitle={(t) => {
                setTitled(true);
                onTitle?.(t);
              }}
            />
          )}
          {clients.length === 0 ? (
            // A first video with nobody to send it to: one clear next step (the title can wait until they're added).
            <div className="mt-2 text-sm text-muted" data-testid="send-no-clients">
              <p className="font-medium text-ink">Next: add the client this is for</p>
              {canAddClient ? (
                <>
                  <p className="mt-1">Add them here and you can send it straight away. This video stays private until you do.</p>
                  <QuickAddClient teamKey={teamKey} onAdded={quickAdded} />
                  <p className="mt-2 text-xs">
                    Adding a whole list? <Link href="/clients" className="font-medium text-accent hover:underline">Paste it on the Clients page</Link>
                  </p>
                </>
              ) : (
                <p className="mt-1">The owner or an admin adds clients and assigns them to you. Once they have, come back here and pick them. This video stays private until then.</p>
              )}
            </div>
          ) : available.length === 0 ? (
            <>
              <p className="mt-2 text-sm text-muted">Every client you can send to has this video.</p>
              {/* Still a way to send it to someone new (O42). */}
              {addControl}
            </>
          ) : (
            <>
              <div ref={box} className="relative mt-3">
                <button
                  type="button"
                  onClick={() => setOpen((o) => !o)}
                  aria-expanded={open}
                  aria-haspopup="listbox"
                  data-testid="client-picker"
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-left text-sm hover:bg-hover"
                >
                  <span className={picked.length ? "truncate text-ink" : "text-dim"}>{label}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className={`shrink-0 text-dim transition ${open ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {open && (
                  <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-xl border border-line-strong bg-surface p-2 shadow-xl">
                    {available.length > 6 && (
                      <input
                        autoFocus
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search clients"
                        aria-label="Search clients"
                        className="mb-2 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
                      />
                    )}
                    {many && (
                      <div className="mb-2 flex flex-wrap gap-1.5 text-xs" role="group" aria-label="Quick picks">
                        <button type="button" onClick={() => pickAll(available.map((c) => c.id))} className="rounded-full border border-line-strong px-2.5 py-1 hover:bg-hover">All clients</button>
                        {team && <button type="button" onClick={() => pickAll(available.filter((c) => c.assignedToId === sendMany!.meId).map((c) => c.id))} className="rounded-full border border-line-strong px-2.5 py-1 hover:bg-hover">My clients</button>}
                        {team && sendMany!.staff.filter((s) => s.id !== sendMany!.meId).map((s) => (
                          <button type="button" key={s.id} onClick={() => pickAll(available.filter((c) => c.assignedToId === s.id).map((c) => c.id))} className="rounded-full border border-line-strong px-2.5 py-1 hover:bg-hover">{s.name}&apos;s clients</button>
                        ))}
                        {picked.length > 0 && <button type="button" onClick={() => setPicked([])} className="rounded-full px-2.5 py-1 text-dim hover:text-ink">Clear</button>}
                      </div>
                    )}
                    <ul role="listbox" aria-multiselectable={many} className="grid max-h-64 gap-0.5 overflow-y-auto">
                      {shown.map((c) => (
                        <li key={c.id} role="option" aria-selected={picked.includes(c.id)} className="flex items-center gap-2 rounded-lg pr-2 hover:bg-hover">
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2 py-1.5 text-sm">
                            <input type={many ? "checkbox" : "radio"} name="send-to" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
                            <span className="min-w-0 break-words text-ink">{c.name}</span>
                          </label>
                          {/* The same two statuses as the Clients page. */}
                          {!reached(c) && (
                            <span className="shrink-0">
                              <LinkBadge sent={sentLink(c)} />
                            </span>
                          )}
                        </li>
                      ))}
                      {shown.length === 0 && <li className="px-2 py-1.5 text-sm text-dim">No clients match.</li>}
                    </ul>
                    {many && (
                      <button type="button" onClick={() => setOpen(false)} className="mt-2 w-full rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover">
                        Done{picked.length ? ` (${picked.length})` : ""}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {addControl}

              {/* Nothing chosen yet: no greyed Send button under the picker (O35). */}
              {chosen.length > 0 && (
                <div className="mt-3">
                  <button
                    onClick={send}
                    disabled={!!busy}
                    data-testid="send"
                    className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
                  >
                    {busy === "send" ? "Sending…" : chosen.length === 1 ? "Send to client" : `Send to ${chosen.length} clients`}
                  </button>
                </div>
              )}
              {!many && primary === null && sendMany === undefined && (
                <p className="mt-1 text-xs text-dim">To send one video to several clients at once, ask the owner or an admin.</p>
              )}
            </>
          )}
        </>
      )}
      {!canPick && !isCopy && uploading && sendMany && (
        <p className="text-sm text-muted">You can send it to more clients once the upload finishes.</p>
      )}
      {!canPick && !isCopy && !sendMany && primary && (
        <p className="text-sm text-muted">To send this video to more clients, ask the owner or an admin to let you send to several clients.</p>
      )}

      {note && (
        <p role={note.error ? "alert" : "status"} data-testid="send-status" className={`mt-3 text-sm ${note.error ? "text-danger-fg" : "text-ok-fg"}`}>
          {note.text}
        </p>
      )}

      {sent.length > 0 && (
        <div className={canPick || isCopy ? "mt-4 border-t border-line pt-1" : ""}>
          {section("email", "Emailed to", emailRows)}
          {section(
            "link",
            "Copy link to",
            linkRows,
            // Josiah's words (23 October 2026).
            <p className="mt-1 text-xs text-muted" data-testid="sec-link-intro">Each link only works for its respective client, so send them one at a time. A client needs their personal link saved on their device to watch.</p>,
          )}
          {section(
            "first",
            "First time client - Personal link required",
            firstRows,
            <div className="mt-1 grid gap-1 text-xs text-muted">
              <p data-testid="sec-first-intro">
                {firstNames.length === 1 ? `${firstNames[0]} hasn't` : "These clients haven't"} opened a SureFrame link yet, so this first one has to come from you.
                The video still goes to {firstNames.length === 1 ? "them" : "each of them"}, along with {firstNames.length === 1 ? "their" : "their own"} personal link.
              </p>
              <details data-testid="sec-first-why">
                <summary className="cursor-pointer font-medium text-accent">Why can&apos;t SureFrame send these?</summary>
                {/* Josiah's words (Decision 18). */}
                <p className="mt-1">
                  A new client&apos;s first link has to come from you, because it carries their private key, which we never see. Once they&apos;ve opened it, clients set to
                  Email get every video after that from us.
                </p>
              </details>
            </div>,
          )}
        </div>
      )}
    </div>
  );
}

/** Adds a client without leaving the video: their own key is made here, as on the Clients page. */
function QuickAddClient({ teamKey, onAdded, onCancel }: { teamKey: CryptoKey; onAdded: (c: ClientOption, route: Route) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [route, setRoute] = useState<Route | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!route) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: route === "email" ? email : "", teamKeyWrap: await wrapKey(await generateKey(), teamKey), keyFingerprint: await fingerprint(teamKey) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? "Couldn't add the client. Try again.");
      const c = data.client as { id: string; name: string; email: string | null; link: string; teamKeyWrap: string | null; assignedToId: string | null };
      onAdded({ id: c.id, name: c.name, email: c.email, link: c.link, teamKeyWrap: c.teamKeyWrap, assignedToId: c.assignedToId, hasLink: false, mine: true, emailable: !!c.email }, route);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={add} className="mt-3 grid gap-3 rounded-xl border border-line-strong bg-surface p-3" data-testid="quick-add">
      <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Client's name" aria-label="Client name" className="min-w-0 rounded-lg border border-line-strong px-3 py-2 text-sm" />
      <RouteChoice route={route} onRoute={setRoute} email={email} onEmail={setEmail} />
      <div className="flex gap-2">
        <button disabled={busy || !name.trim() || !route || (route === "email" && !email.trim())} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
          {busy ? "Adding…" : "Add client"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg px-2 py-2 text-sm text-dim hover:text-ink">Cancel</button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
    </form>
  );
}


/**
 * The date-made title says nothing to a client: offer to name the video before it's sent. Saved as it's typed
 * and when the page is left, like the title box above it, so a typed title isn't lost (O52); Save title saves now.
 */
function TitlePrompt({ videoId, business, onTitle }: { videoId: string; business: string; onTitle?: (title: string) => void }) {
  const [title, setTitle] = useState("");
  const saver = useTitleSaver(videoId, "", onTitle);
  return (
    <form
      data-testid="title-prompt"
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) void saver.flush();
      }}
    >
      <input
        id="send-title"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          saver.change(e.target.value);
        }}
        onBlur={() => void saver.flush()}
        maxLength={200}
        aria-label="Title (clients see it)"
        placeholder="Title (optional, clients see it)"
        className="min-w-0 flex-1 basis-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm"
      />
      <button disabled={!title.trim() || saver.state === "saving"} className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50">
        {saver.state === "saving" ? "Saving…" : "Save title"}
      </button>
      {saver.state === "saved" ? (
        <p className="w-full text-xs text-ok-fg" role="status" data-testid="title-saved">Title saved.</p>
      ) : (
        !saver.error && (
          <p className="w-full text-xs text-dim" data-testid="title-nudge">
            {/* Decision 10: an untitled video reaches clients as "A video from Business A", never the date it was made. */}
            {!title.trim() && <span className="font-medium text-muted">Without a title, your clients see &ldquo;A video from {business}&rdquo;. </span>}
            Saved as you type, and it becomes this video&apos;s title above. Save title saves it now.
          </p>
        )
      )}
      {saver.error && <p role="alert" className="w-full text-xs text-danger-fg">{saver.error}</p>}
    </form>
  );
}
