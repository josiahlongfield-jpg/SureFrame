"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { fingerprint, generateKey, unwrapKey, wrapKey } from "@/lib/e2e/crypto";
import { shareLink, useCanShare, writeClipboard } from "@/lib/clipboard";
import { isDefaultTitle } from "@/lib/videoTitle";
import { LinkBadge, markLinkSent, personalLink } from "./ClientsManager";
import FirstLinkSender from "./FirstLinkSender";
import { useTitleSaver } from "./useTitleSaver";
import type { ClientOption, SendMany } from "./WatchView";

/** A client this recording went to, and their conversation about it (this video, or their own copy); `opened` once they've watched it. */
type Recipient = { clientId: string; convId: string; opened?: boolean };
type RowState = "emailed" | "when-ready" | "copied" | "shared" | "own-email";

/**
 * A client is reached once they've opened a link with their key on a device
 * (their first video's link, or their personal link). Until then an email from
 * us can't open for them, so the business sends that first video's link itself;
 * copying or sending it doesn't count, only their opening it.
 */
const reached = (c: ClientOption) => !!c.hasLink;
const canEmail = (c: ClientOption) => reached(c) && !!c.emailable;

const names = (list: ClientOption[]) => (list.length === 1 ? list[0].name : `${list.slice(0, -1).map((c) => c.name).join(", ")} and ${list[list.length - 1].name}`);

/** Why Send by email isn't there for these clients: no address saved, or they turned emails off. */
function noEmailNote(list: ClientOption[]) {
  const off = list.filter((c) => c.emailsOff);
  const none = list.filter((c) => !c.emailsOff);
  const why = [
    none.length ? `No email address saved for ${names(none)}` : "",
    off.length ? `${names(off)} turned off emails from you` : "",
  ].filter(Boolean);
  return `${why.join(", and ")}, so copy the ${list.length === 1 ? "link" : "links"} and send ${list.length === 1 ? "it" : "them"} yourself.`;
}
const btn = "rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-xs hover:bg-hover disabled:opacity-50";

/**
 * Sending a recording: choose clients from one list, then either we email
 * them, or you copy their links to send from your own app. Each client gets
 * their own private conversation; nobody sees anyone else's replies. A new
 * client's first video goes from you (its link sets them up on their device).
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
  preselect,
}: {
  video: { id: string; title: string; status: string; encrypted: boolean; sourceId: string | null; viewCount?: number };
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
  /** Just recorded: the client to have chosen already (the one the last video went to). */
  preselect?: string | null;
}) {
  const router = useRouter();
  // Clients added from this box, until the page's own list has them.
  const [extra, setExtra] = useState<ClientOption[]>([]);
  // Emails added from this box, until the page's own list has them.
  const [added, setAdded] = useState<Record<string, string>>({});
  const clients = useMemo(
    () => [...given, ...extra.filter((e) => !given.some((c) => c.id === e.id))].map((c) => (added[c.id] && !c.email ? { ...c, email: added[c.id], emailable: true } : c)),
    [given, extra, added],
  );
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
  const [rows, setRows] = useState<Record<string, RowState>>({});
  // What was just done for a client, said under their own row.
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({});
  // Just recorded: the client the last video went to is chosen already (D12), when they can be.
  const [picked, setPicked] = useState<string[]>(() =>
    preselect && !sentToId && !video.sourceId && given.some((c) => c.id === preselect && c.link && c.teamKeyWrap && !c.removed && !c.paused && !c.linkOff) ? [preselect] : [],
  );
  // The client chosen for them, while it's still just that suggestion (said under the picker).
  const [suggested] = useState(() => picked[0]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean }>();
  const [stopping, setStopping] = useState<string | null>(null);
  // Named in this box: it says so, though the title is no longer the default.
  const [titled, setTitled] = useState(false);
  const canShare = useCanShare();
  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const stillSuggested = !!suggested && picked.length === 1 && picked[0] === suggested && recipients.every((r) => r.clientId !== suggested);
  const has = new Set(recipients.map((r) => r.clientId));
  // Who can be chosen: active clients with a key, who don't have it yet.
  const available = clients.filter((c) => c.link && c.teamKeyWrap && !c.removed && !c.paused && !c.linkOff && !has.has(c.id));
  // Several clients at once needs the permission, and the upload to have finished.
  const many = !!sendMany && !uploading && video.encrypted;
  const canPick = !isCopy && (many || !primary);
  const shown = search.trim() ? available.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase())) : available;
  const team = (sendMany?.staff.length ?? 0) > 1;
  const chosen = picked.map((id) => byId.get(id)!).filter(Boolean);
  const chosenEmail = chosen.filter(canEmail);
  const chosenFirst = chosen.filter((c) => !reached(c));
  // Several chosen, some we can email and some we can't: the email button emails those it can, new clients' first links go
  // from their own box above, and anyone else gets a copy button of their own, so no two buttons do the same job.
  const mixed = chosen.length > 1 && chosenEmail.length > 0 && chosenEmail.length < chosen.length;
  const copyWords = canShare ? "Copy link or Share" : "Copy link";
  // Chosen clients who've had a link but can't be emailed, said beside Copy link so it's clear why Send by email isn't there.
  const unemailable = chosen.filter((c) => reached(c) && !c.emailable);

  // Each recipient's personal link for their conversation, worked out ahead so Copy and Share work in one tap.
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

  /** Gives each chosen client this recording; returns their conversations. `email` emails those who can open it from an email. */
  async function deliver(list: ClientOption[], email: boolean) {
    const notifyOf = (c: ClientOption) => email && canEmail(c);
    const wrapFor = async (c: ClientOption) => (c.teamKeyWrap ? wrapKey(rootKey, await unwrapKey(c.teamKeyWrap, teamKey)) : undefined);
    const keyFingerprint = await fingerprint(teamKey);
    const added: Recipient[] = [];
    const states: Record<string, RowState> = {};
    let emailed = 0;
    let rest = list;
    const first = !primaryRef.current;
    if (first && list.length) {
      // The first client gets this video itself.
      const c = list[0];
      rest = list.slice(1);
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: c.id, clientKeyWrap: await wrapFor(c), keyFingerprint, notify: notifyOf(c) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't send it to ${c.name}. Try again.`);
      setPrimary(c.id);
      added.push({ clientId: c.id, convId: video.id });
      if (data.emailed) {
        states[c.id] = data.emailed === "when-ready" ? "when-ready" : "emailed";
        emailed++;
      }
    }
    // Everyone else gets their own copy: one request for those we email, one for the rest.
    for (const notify of [true, false]) {
      const group = rest.filter((c) => notifyOf(c) === notify);
      if (!group.length) continue;
      const res = await fetch(`/api/videos/${video.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: await Promise.all(group.map(async (c) => ({ clientId: c.id, clientKeyWrap: await wrapFor(c) }))), notify, keyFingerprint }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't send it. Try again.");
      const sent = data.sent as { id: string; clientId: string }[];
      added.push(...sent.map((s) => ({ clientId: s.clientId, convId: s.id })));
      // We only know how many emails went out, so each is marked only when they all did.
      if (notify && data.emailed === sent.length) for (const s of sent) states[s.clientId] = "emailed";
      if (notify) emailed += data.emailed ?? 0;
    }
    setRecipients((cur) => [...cur, ...added]);
    setRows((cur) => ({ ...cur, ...states }));
    // The rest of the page (the conversation panel) shows who this video is with.
    if (first && added.length) router.refresh();
    setPicked((cur) => cur.filter((id) => !list.some((c) => c.id === id)));
    return { added, emailed };
  }

  /** Emails the chosen clients who can open it from an email; anyone else stays chosen, with their link to copy. */
  async function sendByEmail() {
    const list = chosenEmail;
    const left = chosen.filter((c) => !canEmail(c));
    setBusy("email");
    setNote(undefined);
    try {
      const { emailed } = await deliver(list, true);
      const firsts = left.filter((c) => !reached(c));
      const noEmail = left.filter((c) => reached(c));
      setNote({
        text: [
          emailed ? `Emailed ${emailed} ${emailed === 1 ? "client" : "clients"}.` : "",
          firsts.length ? `${firsts.length === 1 ? `${firsts[0].name}'s first video comes` : `First videos for ${firsts.length} clients come`} from you: send ${firsts.length === 1 ? "it" : "each one"} with the buttons under their name.` : "",
          noEmail.length ? `${noEmail.length === 1 ? noEmail[0].name : `${noEmail.length} clients`} can't be emailed, so use ${copyWords} for them.` : "",
        ].filter(Boolean).join(" "),
      });
    } catch (err) {
      setNote({ text: (err as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  }

  async function sendByLink(list = chosen) {
    setBusy("link");
    setNote(undefined);
    try {
      if (list.length === 1) {
        // One client: their link goes straight onto the clipboard, ready to paste into any app.
        const c = list[0];
        await writeClipboard(deliver(list, false).then(({ added }) => linkFor(c, added[0].convId)));
        void markLinkSent(c.id);
        setRows((cur) => ({ ...cur, [c.id]: "copied" }));
        setNote({ text: `${c.name}'s link is copied. Paste it into your own app, text or email. It only opens for ${c.name}.` });
      } else {
        await writeClipboard(deliver(list, false).then(({ added }) => linesFor(added)));
        list.forEach((c) => void markLinkSent(c.id));
        setRows((cur) => ({ ...cur, ...Object.fromEntries(list.map((c) => [c.id, "copied" as const])) }));
        setNote({ text: `Copied ${list.length} links, one per line with each client's name. Send each client only their own link. ${OWN_LINKS}` });
      }
    } catch (err) {
      setNote({ text: (err as Error).message || "Couldn't copy the link. Try again.", error: true });
    } finally {
      setBusy(null);
    }
  }

  /** "Client A: <link>" lines for the clients just sent to. */
  async function linesFor(added: Recipient[]) {
    const lines = await Promise.all(added.map(async (r) => `${byId.get(r.clientId)!.name}: ${await linkFor(byId.get(r.clientId)!, r.convId)}`));
    return lines.join("\n");
  }

  /** A chosen client getting their first video: gives them this video, then its link, which sets them up (the buttons say what's done with it). */
  // First videos go out one at a time, and once per client however many of its buttons are pressed.
  const firstQueue = useRef<Promise<unknown>>(Promise.resolve());
  const firstLinks = useRef(new Map<string, Promise<string>>());
  function deliverFirst(c: ClientOption) {
    let link = firstLinks.current.get(c.id);
    if (!link) {
      link = firstQueue.current.then(async () => {
        setNote(undefined);
        const { added } = await deliver([c], false);
        return linkFor(c, added[0].convId);
      });
      firstQueue.current = link.catch(() => {});
      firstLinks.current.set(c.id, link);
      link.catch(() => firstLinks.current.delete(c.id));
    }
    return link;
  }

  /**
   * After a first video's link went out by any of the ways in FirstLinkSender. What happened is said under that
   * client's own row (S14), not at the foot of the box, where it sat under the next client's buttons.
   */
  function firstSent(c: ClientOption, how: "link" | "message" | "share" | "email") {
    void markLinkSent(c.id);
    setRows((cur) => ({ ...cur, [c.id]: how === "share" ? "shared" : how === "email" ? "own-email" : "copied" }));
    setNote(undefined);
    setRowNotes((cur) => ({
      ...cur,
      [c.id]:
        how === "email"
          ? `Your email app should open with ${c.name}'s link and a short message, ready to send. Nothing opened? Use Copy link and paste it into an email.`
          : how === "share"
            ? `Shared ${c.name}'s link with a short message. Once they open it, Send by email works for them too.`
            : `${c.name}'s link is copied${how === "message" ? " with a short message" : ""}. Paste it into a text, chat or email to them. It only opens for ${c.name}.`,
    }));
  }

  /** An email saved from this box: Send by email works for them straight away once they've opened a video. */
  function emailAdded(c: ClientOption, email: string) {
    setAdded((cur) => ({ ...cur, [c.id]: email }));
    setNote({ text: `Saved ${c.name}'s email.` });
    router.refresh();
  }

  /** A client added from this box: chosen straight away, so the ways to send their first video are the next thing shown. */
  function quickAdded(c: ClientOption) {
    setExtra((cur) => [...cur, c]);
    setPicked((cur) => (many ? [...cur, c.id] : [c.id]));
    setAdding(false);
  }

  async function copyRow(r: Recipient) {
    const link = links[r.convId];
    if (!link) return;
    await writeClipboard(link);
    void markLinkSent(r.clientId);
    setRows((cur) => ({ ...cur, [r.clientId]: "copied" }));
  }

  async function shareRow(r: Recipient) {
    const link = links[r.convId];
    if (!link) return;
    if (await shareLink(link, video.title)) {
      void markLinkSent(r.clientId);
      setRows((cur) => ({ ...cur, [r.clientId]: "shared" }));
    }
  }

  async function emailRow(r: Recipient) {
    setNote(undefined);
    const res = await fetch(`/api/videos/${r.convId}/notify`, { method: "POST" }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) return setNote({ text: data?.error ?? "Couldn't send it. Try again.", error: true });
    setRows((cur) => ({ ...cur, [r.clientId]: data.emailed === "when-ready" ? "when-ready" : "emailed" }));
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
    firstLinks.current.delete(r.clientId);
    if (own) {
      setPrimary(null);
      router.refresh();
    }
    setNote({ text: `${c?.name ?? "That client"} can no longer open this video.` });
  }

  const label = picked.length === 0 ? (many ? "Choose clients" : "Choose a client") : picked.length === 1 ? byId.get(picked[0])?.name : `${picked.length} clients chosen`;
  const isBlocked = (c: ClientOption) => !!(c.removed || c.paused || c.linkOff || !c.link);
  const sentRows = recipients.filter((r) => byId.has(r.clientId));
  const sentLink = (c: ClientOption) => c.linkSent || rows[c.id] === "copied" || rows[c.id] === "shared" || rows[c.id] === "own-email";

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

  // New clients chosen: their first video goes from the business, so each gets the ways to send it.
  const showLinkBox = chosenFirst.length > 0;
  // Just one new client, nobody else: their buttons are the send buttons, under one line saying so.
  const soloFirst = chosen.length === 1 && chosenFirst.length === 1;
  const linkBox = soloFirst ? (
    <div className="mt-3" data-testid="first-time">
      <FirstWhy one={chosenFirst[0].name}>
        {/* Josiah's words (Decision 18). */}
        <p>A new client&apos;s first link has to come from you, because it carries their private key, which we never see. Once they&apos;ve opened it, Send by email does the rest.</p>
      </FirstWhy>
      {!chosenFirst[0].email && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="no-email">
          <p className="text-xs font-medium text-warn-fg">No email address saved for {chosenFirst[0].name}.</p>
          <AddEmail client={chosenFirst[0]} onSaved={emailAdded} />
        </div>
      )}
      <div className="mt-2" data-testid="first-links">
        <div data-testid="first-link-row">
          <FirstLinkSender video name={chosenFirst[0].name} email={chosenFirst[0].email} business={business} disabled={!!busy} getLink={() => deliverFirst(chosenFirst[0])} onSent={(how) => firstSent(chosenFirst[0], how)} />
        </div>
      </div>
    </div>
  ) : (
    <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm text-ink" data-testid="first-time">
      <FirstWhy many={chosenFirst.map((c) => c.name)}>
        <p>A new client&apos;s first link has to come from you, because it carries their private key, which we never see. Once they&apos;ve opened it, Send by email does the rest.</p>
      </FirstWhy>
      <ul className="mt-2 grid gap-2" data-testid="first-links">
        {chosenFirst.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="first-link-row">
            <span className="min-w-0 break-words font-medium">
              {c.name}
              {!c.email && (
                <span className="ml-2 inline-flex flex-wrap items-center gap-x-2 text-xs font-normal" data-testid="no-email">
                  <span className="text-warn-fg">No email saved</span>
                  <AddEmail client={c} onSaved={emailAdded} />
                </span>
              )}
            </span>
            {/* The same three ways as for one client, Copy link + message included (S15). */}
            <FirstLinkSender compact video name={c.name} email={c.email} business={business} disabled={!!busy} getLink={() => deliverFirst(c)} onSent={(how) => firstSent(c, how)} />
          </li>
        ))}
      </ul>
    </div>
  );

  /** One recipient's row: their name, what happened, Copy link (and Share, Email), and Stop sharing behind a confirm. */
  const row = (r: Recipient) => {
    const c = byId.get(r.clientId)!;
    const blocked = isBlocked(c);
    const state = rows[r.clientId];
    return (
      <li key={r.convId} className="rounded-xl bg-surface-2 px-3 py-2 text-sm" data-testid="sent-row">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 break-words">
            {r.convId === video.id ? <span className="font-medium text-ink">{c.name}</span> : (
              <Link href={`/v/${r.convId}`} className="font-medium text-ink hover:text-accent hover:underline">{c.name}</Link>
            )}{" "}
            {state && (
              <span className="ml-2 text-xs text-ok-fg">
                {/* Copying a link or opening the email app isn't sending it: say only what happened here (O33, O41). */}
                {state === "emailed" ? "Emailed" : state === "when-ready" ? "Emailed when the upload finishes" : state === "shared" ? "Shared" : state === "own-email" ? "Email app opened" : "Link copied"}
              </span>
            )}
            {!blocked && (
              // Whether they've watched it yet, so a row says more than "Emailed".
              <span className={`ml-2 text-xs ${r.opened ? "text-ok-fg" : "text-dim"}`} data-testid="row-opened">
                {r.opened ? "· Opened" : "· Not opened yet"}
              </span>
            )}
          </span>
          <span className="flex flex-wrap gap-1.5">
            {!blocked && !reached(c) && (
              <FirstLinkSender compact plain short inline video name={c.name} email={c.email} business={business} disabled={!links[r.convId]} getLink={async () => links[r.convId]} onSent={(how) => firstSent(c, how)} />
            )}
            {!blocked && reached(c) && (
              <>
                {canEmail(c) && (
                  <button onClick={() => emailRow(r)} className={btn}>{state === "emailed" ? "Send again" : "Send by email"}</button>
                )}
                <button onClick={() => copyRow(r)} disabled={!links[r.convId]} data-testid="copy-row-link" className={btn}>
                  Copy link
                </button>
                {canShare && (
                  <button onClick={() => shareRow(r)} disabled={!links[r.convId]} className={btn}>Share</button>
                )}
              </>
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
        ) : !reached(c) && !sentLink(c) ? (
          <p className="mt-1 text-xs text-dim" data-testid="row-first">Not sent yet: email it from your email or copy the link.</p>
        ) : !c.emailable && state !== "copied" && state !== "shared" ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-xs text-dim">
              {c.emailsOff ? `${c.name} turned off emails from you` : `${c.name} has no email address saved`}, so send them the link yourself.
            </p>
            {!c.emailsOff && <AddEmail client={c} onSaved={emailAdded} />}
          </div>
        ) : null}
        {rowNotes[r.clientId] && (
          <p role="status" className="mt-1 text-xs text-ok-fg" data-testid="row-note">
            {rowNotes[r.clientId]}
          </p>
        )}
        {stopping === r.convId && stopBox(r)}
      </li>
    );
  };

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
              {showLinkBox && linkBox}
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
                  data-preselected={stillSuggested ? byId.get(suggested!)?.name : undefined}
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

              {stillSuggested && (
                <p className="mt-1 text-xs text-dim" data-testid="preselected-note">
                  {byId.get(suggested!)?.name} is chosen: your last video went to them. Change it above if this one is for someone else.
                </p>
              )}

              {addControl}

              {/* Under the picker, so who's chosen and who still needs their link read in order. */}
              {showLinkBox && linkBox}

              {unemailable.length > 0 && (
                <div className="mt-3" data-testid="no-email">
                  <p className="text-xs font-medium text-warn-fg">{noEmailNote(unemailable)}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {unemailable.filter((c) => !c.emailsOff).map((c) => (
                      <AddEmail key={c.id} client={c} label={unemailable.length > 1 ? `Add ${c.name}'s email` : undefined} onSaved={emailAdded} />
                    ))}
                  </div>
                </div>
              )}
              {/* Nothing chosen yet: no greyed Send/Copy pair under the picker (O35). */}
              {picked.length > 0 && <div className="mt-3 flex flex-wrap gap-2">
                {chosenEmail.length > 0 && (
                  <button
                    onClick={sendByEmail}
                    disabled={!chosenEmail.length || !!busy}
                    data-testid="send-email"
                    className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
                  >
                    {busy === "email" ? "Sending…" : mixed ? `Email ${chosenEmail.length <= 2 ? names(chosenEmail) : `${chosenEmail.length} clients`}` : "Send by email"}
                  </button>
                )}
                {mixed && unemailable.length > 0 && (
                  <button
                    onClick={() => sendByLink(unemailable)}
                    disabled={!!busy}
                    data-testid="send-link"
                    className="rounded-xl border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50"
                  >
                    {busy === "link" ? "Copying…" : unemailable.length === 1 ? `Copy ${unemailable[0].name}'s link` : `Copy ${unemailable.length} links`}
                  </button>
                )}
                {!mixed && !soloFirst && (
                  <button
                    onClick={() => sendByLink()}
                    disabled={!picked.length || !!busy}
                    data-testid="send-link"
                    className="rounded-xl border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50"
                  >
                    {busy === "link" ? "Copying…" : picked.length > 1 ? `Copy all ${picked.length} links` : "Copy link"}
                  </button>
                )}
              </div>}
              {mixed && (
                // What each part does, in the order it's done: the email button, then the boxes and buttons for the rest.
                <p className="mt-2 text-sm text-muted" data-testid="send-mixed-explained">
                  {`${names(chosenEmail)} ${chosenEmail.length === 1 ? "gets" : "get"} it by email.`}
                  {chosenFirst.length > 0 && ` ${names(chosenFirst)} ${chosenFirst.length === 1 ? "is" : "are"} new, so ${chosenFirst.length === 1 ? "their first link comes" : "their first links come"} from you, in the box above.`}
                </p>
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

      {sentRows.length > 0 && (
        <div className={canPick || isCopy ? "mt-4 border-t border-line pt-4" : ""}>
          {/* Not "Sent to": a first video's link may only have been copied so far, and each row says what happened (O33). */}
          <h3 className="text-sm font-medium text-ink" data-testid="sent-heading">Shared with {sentRows.length} {sentRows.length === 1 ? "client" : "clients"}</h3>
          <ul className="mt-2 grid gap-2" data-testid="sent-list">
            {sentRows.map((r) => row(r))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Copied links differ per client (and from this page's address): each opens that client's own encrypted copy. */
const OWN_LINKS = "Each link is different because each client gets their own private copy and conversation.";

/**
 * A new client's first video: one line on what to do, the same as the Clients page's steps ("Send their first video
 * yourself … After that, we email them"), with the longer why behind "Why does the first video come from me?" (O32, S13).
 */
function FirstWhy({ one, many, children }: { one?: string; many?: string[]; children: React.ReactNode }) {
  const who = one ?? (many && many.length === 1 ? many[0] : null);
  return (
    <div className="grid gap-1 text-sm text-ink" data-testid="first-why">
      <p data-testid="first-why-line">
        {who ? (
          <>
            <span className="font-medium">First video for {who}:</span> send it yourself, from your email or by copying the link. They just open it and watch.
          </>
        ) : (
          <>
            <span className="font-medium">First videos for {many?.length ?? 0} clients:</span> send each one yourself, from your email or by copying the link. They just open it and watch.
          </>
        )}{" "}
        After that, we email them: press Send by email for every video after the first.
      </p>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer font-medium text-accent" data-testid="first-why-more">Why does the first video come from me?</summary>
        <div className="mt-1 grid gap-1">{children}</div>
      </details>
    </div>
  );
}

/** Saves an email for a client who has none, without leaving the video. */
function AddEmail({ client, label, onSaved }: { client: ClientOption; label?: string; onSaved: (c: ClientOption, email: string) => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-accent hover:underline" data-testid="add-email">
        {label ?? "Add email"}
      </button>
    );
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/clients/${client.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? "Couldn't save the email. Try again.");
      onSaved(client, email.trim());
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="flex w-full flex-wrap items-center gap-2" data-testid="add-email-form">
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        type="email"
        required
        autoFocus
        placeholder={`${client.name}'s email`}
        aria-label={`${client.name}'s email`}
        className="min-w-0 flex-1 rounded-lg border border-line-strong px-3 py-1.5 text-sm"
      />
      <button disabled={busy || !email.trim()} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1.5 text-sm text-dim hover:text-ink">Cancel</button>
      {error && <p role="alert" className="w-full text-xs text-danger-fg">{error}</p>}
    </form>
  );
}

/** Adds a client without leaving the video: their own key is made here, as on the Clients page. */
function QuickAddClient({ teamKey, onAdded, onCancel }: { teamKey: CryptoKey; onAdded: (c: ClientOption) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, teamKeyWrap: await wrapKey(await generateKey(), teamKey), keyFingerprint: await fingerprint(teamKey) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? "Couldn't add the client. Try again.");
      const c = data.client as { id: string; name: string; email: string | null; link: string; teamKeyWrap: string | null; assignedToId: string | null };
      onAdded({ id: c.id, name: c.name, email: c.email, link: c.link, teamKeyWrap: c.teamKeyWrap, assignedToId: c.assignedToId, hasLink: false, mine: true, emailable: !!c.email });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={add} className="mt-3 grid gap-2 rounded-xl border border-line-strong bg-surface p-3 sm:grid-cols-[1fr_1fr_auto]" data-testid="quick-add">
      <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Client's name" aria-label="Client name" className="min-w-0 rounded-lg border border-line-strong px-3 py-2 text-sm" />
      <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email (optional)" aria-label="Client email" className="min-w-0 rounded-lg border border-line-strong px-3 py-2 text-sm" />
      <div className="flex gap-2">
        <button disabled={busy || !name.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
          {busy ? "Adding…" : "Add client"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg px-2 py-2 text-sm text-dim hover:text-ink">Cancel</button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-danger-fg sm:col-span-3">{error}</p>}
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
