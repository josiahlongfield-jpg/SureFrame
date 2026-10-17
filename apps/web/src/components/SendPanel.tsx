"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { fingerprint, unwrapKey, wrapKey } from "@/lib/e2e/crypto";
import { shareLink, useCanShare, writeClipboard } from "@/lib/clipboard";
import { isDefaultTitle } from "@/lib/videoTitle";
import { markLinkSent, personalLink } from "./ClientsManager";
import type { ClientOption, SendMany } from "./WatchView";

/** A client this recording went to, and their conversation about it (this video, or their own copy). */
type Recipient = { clientId: string; convId: string };
type RowState = "emailed" | "when-ready" | "copied" | "shared";

/**
 * A client is reached once they've opened their personal link (the one with
 * their key) on a device. Until then an email can't open for them, so the
 * business sends that first link itself; copying it doesn't count.
 */
const reached = (c: ClientOption) => !!c.hasLink;
const canEmail = (c: ClientOption) => reached(c) && !!c.emailable;
const btn = "rounded-lg border border-line-strong bg-surface px-2.5 py-1 text-xs hover:bg-hover disabled:opacity-50";

/**
 * Sending a recording: choose clients from one list, then either we email
 * them, or you copy their links to send from your own app. Each client gets
 * their own private conversation; nobody sees anyone else's replies. Clients
 * who haven't opened their personal link yet are marked, and get it from you.
 */
export default function SendPanel({
  video,
  clients,
  sentToId,
  sendMany,
  hasReplies,
  rootKey,
  teamKey,
  onTitle,
}: {
  video: { id: string; title: string; status: string; encrypted: boolean; sourceId: string | null };
  clients: ClientOption[];
  sentToId: string | null;
  /** Set when this person may send one recording to several clients. */
  sendMany?: SendMany;
  hasReplies: boolean;
  rootKey: CryptoKey;
  teamKey: CryptoKey;
  /** Called with a link the team copied or shared (kept for the watch page; reaching a client is their opening it). */
  onLinkCopied?: (clientId: string) => void;
  /** A title given in the Send box, so the page heading shows it too. */
  onTitle?: (title: string) => void;
}) {
  const router = useRouter();
  const isCopy = !!video.sourceId;
  const uploading = video.status === "RECORDING";
  const [primary, setPrimary] = useState(sentToId);
  const [recipients, setRecipients] = useState<Recipient[]>(() => [
    ...(sentToId ? [{ clientId: sentToId, convId: video.id }] : []),
    ...(sendMany?.copies ?? []).map((c) => ({ clientId: c.clientId, convId: c.id })),
  ]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean }>();
  const [stopping, setStopping] = useState<string | null>(null);
  // Named in this box: it says so, though the title is no longer the default.
  const [titled, setTitled] = useState(false);
  const canShare = useCanShare();
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
  const chosenEmail = chosen.filter(canEmail);
  const chosenFirst = chosen.filter((c) => !reached(c));
  const copyWords = canShare ? "Copy link or Share" : "Copy link";

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
    if (!primary && list.length) {
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
    if (!primary && added.length) router.refresh();
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
          firsts.length ? `${firsts.length === 1 ? `${firsts[0].name} still needs` : `${firsts.length} clients still need`} their first link: use the Copy buttons under Needs first link.` : "",
          noEmail.length ? `${noEmail.length === 1 ? noEmail[0].name : `${noEmail.length} clients`} can't be emailed, so use ${copyWords} for them.` : "",
        ].filter(Boolean).join(" "),
      });
    } catch (err) {
      setNote({ text: (err as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  }

  async function sendByLink() {
    const list = chosen;
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
        await deliver(list, false);
        setNote({ text: `Sent. Now send each client their own link: use ${copyWords} on each row below. Each link only opens for that client.` });
      }
    } catch (err) {
      setNote({ text: (err as Error).message || "Couldn't copy the link. Try again.", error: true });
    } finally {
      setBusy(null);
    }
  }

  /** "Copy Client A's link" for a chosen client who needs their first link: sends it to them, then copies it. */
  async function copyFirst(c: ClientOption) {
    setBusy(`first:${c.id}`);
    setNote(undefined);
    try {
      await writeClipboard(deliver([c], false).then(({ added }) => linkFor(c, added[0].convId)));
      void markLinkSent(c.id);
      setRows((cur) => ({ ...cur, [c.id]: "copied" }));
      setNote({ text: `${c.name}'s link is copied. Paste it into a text, message or your own email. It only opens for ${c.name}.` });
    } catch (err) {
      setNote({ text: (err as Error).message || "Couldn't copy the link. Try again.", error: true });
    } finally {
      setBusy(null);
    }
  }

  /** Share for a chosen client who needs their first link: sends it to them, then opens the share sheet. */
  async function shareFirst(c: ClientOption) {
    setBusy(`first:${c.id}`);
    setNote(undefined);
    try {
      const { added } = await deliver([c], false);
      const link = await linkFor(c, added[0].convId);
      // A slow send can use up the tap the share sheet needs; their row below has its own Share.
      if (await shareLink(link, video.title)) {
        void markLinkSent(c.id);
        setRows((cur) => ({ ...cur, [c.id]: "shared" }));
      } else setNote({ text: `Sent to ${c.name}. Tap Share on their row below to send them their link.` });
    } catch (err) {
      setNote({ text: (err as Error).message || "Couldn't send it. Try again.", error: true });
    } finally {
      setBusy(null);
    }
  }

  /** Sends it to every chosen client who needs their first link, and copies all their links, one per line with their name. */
  async function copyAllFirst() {
    const list = chosenFirst;
    setBusy("first-all");
    setNote(undefined);
    try {
      await writeClipboard(
        deliver(list, false).then(async ({ added }) => {
          const lines = await Promise.all(added.map(async (r) => `${byId.get(r.clientId)!.name}: ${await linkFor(byId.get(r.clientId)!, r.convId)}`));
          return lines.join("\n");
        }),
      );
      list.forEach((c) => void markLinkSent(c.id));
      setRows((cur) => ({ ...cur, ...Object.fromEntries(list.map((c) => [c.id, "copied" as const])) }));
      setNote({ text: `Copied ${list.length} first links, one per line with each client's name. Send each client only their own link.` });
    } catch (err) {
      setNote({ text: (err as Error).message || "Couldn't copy the links. Try again.", error: true });
    } finally {
      setBusy(null);
    }
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
    if (own) {
      setPrimary(null);
      router.refresh();
    }
    setNote({ text: `${c?.name ?? "That client"} can no longer open this video.` });
  }

  const label = picked.length === 0 ? (many ? "Choose clients" : "Choose a client") : picked.length === 1 ? byId.get(picked[0])?.name : `${picked.length} clients chosen`;
  const isBlocked = (c: ClientOption) => !!(c.removed || c.paused || c.linkOff || !c.link);
  const sentRows = recipients.filter((r) => byId.has(r.clientId) && (reached(byId.get(r.clientId)!) || isBlocked(byId.get(r.clientId)!)));
  const waitingRows = recipients.filter((r) => byId.has(r.clientId) && !reached(byId.get(r.clientId)!) && !isBlocked(byId.get(r.clientId)!));
  const firstTimersAvailable = available.some((c) => !reached(c));

  /** One recipient's row: their name, what happened, Copy link (and Share, Email), and Stop sharing behind a confirm. */
  const row = (r: Recipient, waiting: boolean) => {
    const c = byId.get(r.clientId)!;
    const blocked = isBlocked(c);
    const state = rows[r.clientId];
    const own = r.convId === video.id && !isCopy;
    return (
      <li key={r.convId} className="rounded-xl bg-surface-2 px-3 py-2 text-sm" data-testid={waiting ? "waiting-row" : "sent-row"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 break-words">
            {r.convId === video.id ? <span className="font-medium text-ink">{c.name}</span> : (
              <Link href={`/v/${r.convId}`} className="font-medium text-ink hover:text-accent hover:underline">{c.name}</Link>
            )}
            {state && (
              <span className="ml-2 text-xs text-ok-fg">
                {state === "emailed" ? "Emailed" : state === "when-ready" ? "Emailed when the upload finishes" : state === "shared" ? "Shared" : "Link copied"}
              </span>
            )}
          </span>
          <span className="flex flex-wrap gap-1.5">
            {!blocked && (
              <>
                {canEmail(c) && (
                  <button onClick={() => emailRow(r)} className={btn}>{state === "emailed" ? "Email again" : "Email"}</button>
                )}
                <button onClick={() => copyRow(r)} disabled={!links[r.convId]} data-testid="copy-row-link" className={btn}>
                  {waiting ? `Copy ${c.name}'s link` : "Copy link"}
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
        ) : waiting ? (
          <p className="mt-1 text-xs text-dim">
            {state === "copied" || state === "shared" ? `Sent? Once ${c.name} opens it, they move up to Sent to.` : `Copy ${c.name}'s link and send it to them yourself. Once they open it, emailing works too.`}
          </p>
        ) : !c.emailable && state !== "copied" && state !== "shared" ? (
          <p className="mt-1 text-xs text-dim">
            {c.emailsOff ? `${c.name} turned off emails from you` : `${c.name} has no email address saved`}, so send them the link yourself.
          </p>
        ) : null}
        {stopping === r.convId && (
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
        )}
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
          {!uploading && (isDefaultTitle(video.title) || titled) && (
            <TitlePrompt
              videoId={video.id}
              onTitle={(t) => {
                setTitled(true);
                onTitle?.(t);
              }}
            />
          )}
          {clients.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Add your clients first, then you can pick them here.{" "}
              <Link href="/clients" className="font-medium text-accent hover:underline">Add clients</Link>
            </p>
          ) : available.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Every client you can send to has this video.</p>
          ) : (
            <>
              {firstTimersAvailable && (
                <div className="mt-2 text-xs text-dim" data-testid="first-link-rule">
                  <FirstTime />
                </div>
              )}
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
                          {!reached(c) && (
                            <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-accent" data-testid="needs-first-link">Needs first link</span>
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

              {chosenFirst.length > 0 && (
                <div className="mt-3 rounded-xl border border-primary bg-primary-soft p-3 text-sm text-ink" data-testid="first-links">
                  <p className="font-medium">Needs first link</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {chosenFirst.length === 1 ? `${chosenFirst[0].name} hasn't` : "These clients haven't"} opened their personal link yet, so we can&apos;t email them this time.
                    Press {chosenFirst.length > 1 ? "each Copy button" : "Copy"}{canShare ? " or Share" : ""} and send the link yourself, for example by text or message.
                  </p>
                  <ul className="mt-2 grid gap-1.5">
                    {chosenFirst.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-1.5">
                        <button onClick={() => copyFirst(c)} disabled={!!busy} data-testid="copy-first-link" className={btn}>
                          {busy === `first:${c.id}` ? "Copying…" : `Copy ${c.name}'s link`}
                        </button>
                        {canShare && (
                          <button onClick={() => shareFirst(c)} disabled={!!busy} className={btn}>Share</button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {chosenFirst.length > 1 && (
                    <button onClick={copyAllFirst} disabled={!!busy} data-testid="copy-all-first" className="mt-2 rounded-lg bg-solid px-3 py-1.5 text-xs font-medium text-white hover:bg-solid-hover disabled:opacity-60">
                      {busy === "first-all" ? "Copying…" : "Copy all first links"}
                    </button>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {(picked.length === 0 || chosenEmail.length > 0) && (
                  <button
                    onClick={sendByEmail}
                    disabled={!chosenEmail.length || !!busy}
                    data-testid="send-email"
                    className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
                  >
                    {busy === "email" ? "Sending…" : chosenEmail.length && chosenEmail.length < chosen.length ? `Email ${chosenEmail.length} of them` : "Send by email"}
                  </button>
                )}
                <button
                  onClick={sendByLink}
                  disabled={!picked.length || !!busy}
                  data-testid="send-link"
                  className="rounded-xl border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50"
                >
                  {busy === "link" ? "Copying…" : picked.length > 1 ? "Get their links" : "Copy link"}
                </button>
              </div>
              <p className="mt-2 text-xs text-dim">
                Send by email and we email each client to say it&apos;s waiting. Or copy the link and send it from your own app, texts or messages. Either way it opens on SureFrame, for that client only.
              </p>
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

      {recipients.length === 0 && !isCopy && clients.length > 0 && (
        <p className="mt-3 text-xs text-dim" data-testid="send-private">Nobody outside your team can watch this until you send it.</p>
      )}
      {waitingRows.length > 0 && (
        <div className={canPick || isCopy ? "mt-4 border-t border-line pt-4" : ""}>
          <h3 className="text-sm font-medium text-ink">Waiting for their first link</h3>
          <p className="mt-0.5 text-xs text-dim">They have this video, but can&apos;t open it until they&apos;ve opened their personal link from you.</p>
          <ul className="mt-2 grid gap-2" data-testid="waiting-list">
            {waitingRows.map((r) => row(r, true))}
          </ul>
        </div>
      )}
      {sentRows.length > 0 && (
        <div className={canPick || isCopy || waitingRows.length ? "mt-4 border-t border-line pt-4" : ""}>
          <h3 className="text-sm font-medium text-ink">Sent to</h3>
          <ul className="mt-2 grid gap-2" data-testid="sent-list">
            {sentRows.map((r) => row(r, false))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Why a client's first link comes from the business: shown up front, before anyone presses Send. */
function FirstTime() {
  return (
    <details data-testid="first-time">
      <summary className="cursor-pointer">
        Clients marked Needs first link haven&apos;t opened their personal link yet. This first time, copy it and send it to them yourself. After that, Send by email works for them too. <span className="text-accent">Why?</span>
      </summary>
      <p className="mt-1">
        Your videos are end-to-end encrypted. Each client&apos;s personal link holds their private key, which only your team&apos;s devices have, so we can&apos;t email it without being able to see their videos.
        Once they open it, their phone or computer remembers it, and emailed videos open there.
      </p>
    </details>
  );
}

/** The date-made title says nothing to a client: offer to name the video before it's sent. */
function TitlePrompt({ videoId, onTitle }: { videoId: string; onTitle?: (title: string) => void }) {
  const [title, setTitle] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string>();
  if (state === "saved") return <p className="mt-2 text-xs text-ok-fg" data-testid="title-saved">Title saved.</p>;
  return (
    <form
      data-testid="title-prompt"
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t) return;
        setState("saving");
        setError(undefined);
        const res = await fetch(`/api/videos/${videoId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t }) }).catch(() => null);
        if (!res?.ok) {
          setState("idle");
          return setError((await res?.json().catch(() => ({})))?.error ?? "Couldn't save the title. Try again.");
        }
        setState("saved");
        onTitle?.(t);
      }}
    >
      <label htmlFor="send-title" className="w-full text-xs text-dim">
        Give it a title first? Clients see it on their page and in the email.
      </label>
      <input
        id="send-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        placeholder="For example: Week 1 plan"
        className="min-w-0 flex-1 basis-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm"
      />
      <button disabled={!title.trim() || state === "saving"} className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover disabled:opacity-50">
        {state === "saving" ? "Saving…" : "Save title"}
      </button>
      {error && <p role="alert" className="w-full text-xs text-danger-fg">{error}</p>}
    </form>
  );
}
