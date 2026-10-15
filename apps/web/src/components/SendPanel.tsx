"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { fingerprint, unwrapKey, wrapKey } from "@/lib/e2e/crypto";
import { personalLink } from "./ClientsManager";
import type { ClientOption, SendMany } from "./WatchView";

/** A client this recording went to, and their conversation about it (this video, or their own copy). */
type Recipient = { clientId: string; convId: string };
type RowState = "emailed" | "when-ready" | "copied" | "shared";

const first = (name: string) => name.split(" ")[0];

/**
 * Copies text worked out after a click. Safari only lets a page write to the
 * clipboard during the click itself, so the text goes in as a promise.
 */
async function writeClipboard(text: Promise<string> | string) {
  const pending = Promise.resolve(text);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": pending.then((t) => new Blob([t], { type: "text/plain" })) })]);
      return;
    } catch {
      /* older browsers: plain text below */
    }
  }
  await navigator.clipboard.writeText(await pending);
}

/**
 * Sending a recording: choose clients from one list, then either we email
 * them, or you copy their links to send from your own app. Each client gets
 * their own private conversation; nobody sees anyone else's replies.
 */
export default function SendPanel({
  video,
  clients,
  sentToId,
  sendMany,
  hasReplies,
  rootKey,
  teamKey,
  onLinkCopied,
}: {
  video: { id: string; title: string; status: string; encrypted: boolean; sourceId: string | null };
  clients: ClientOption[];
  sentToId: string | null;
  /** Set when this person may send one recording to several clients. */
  sendMany?: SendMany;
  hasReplies: boolean;
  rootKey: CryptoKey;
  teamKey: CryptoKey;
  onLinkCopied: (clientId: string) => void;
}) {
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
  const [busy, setBusy] = useState<"email" | "link" | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean }>();
  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const has = new Set(recipients.map((r) => r.clientId));
  // Who can be chosen: active clients with a key, who don't have it yet.
  const available = clients.filter((c) => c.link && c.teamKeyWrap && !c.removed && !c.paused && !c.linkOff && !has.has(c.id));
  // Several clients at once needs the permission, and the upload to have finished.
  const many = !!sendMany && !uploading && video.encrypted;
  const canPick = !isCopy && (many || !primary);
  const shown = search.trim() ? available.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase())) : available;
  const team = (sendMany?.staff.length ?? 0) > 1;

  // Each recipient's personal link for their conversation, worked out ahead so Copy and Share work in one tap.
  const [links, setLinks] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, string> = {};
      for (const r of recipients) {
        const c = byId.get(r.clientId);
        if (!c?.link) continue;
        const url = new URL(c.link);
        url.searchParams.set("v", r.convId);
        out[r.convId] = await personalLink(url.toString(), c.teamKeyWrap, teamKey);
      }
      if (!cancelled) setLinks(out);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [recipients, byId, teamKey]);

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
  async function deliver(chosen: ClientOption[], email: boolean) {
    const canEmail = (c: ClientOption) => email && !!c.hasLink && !!c.emailable;
    const wrapFor = async (c: ClientOption) => (c.teamKeyWrap ? wrapKey(rootKey, await unwrapKey(c.teamKeyWrap, teamKey)) : undefined);
    const keyFingerprint = await fingerprint(teamKey);
    const added: Recipient[] = [];
    const states: Record<string, RowState> = {};
    let emailed = 0;
    let rest = chosen;
    if (!primary && chosen.length) {
      // The first client gets this video itself.
      const c = chosen[0];
      rest = chosen.slice(1);
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: c.id, clientKeyWrap: await wrapFor(c), keyFingerprint, notify: canEmail(c) }),
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
      const group = rest.filter((c) => canEmail(c) === notify);
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
    setPicked([]);
    return { added, emailed };
  }

  async function sendByEmail() {
    const chosen = picked.map((id) => byId.get(id)!).filter(Boolean);
    setBusy("email");
    setNote(undefined);
    try {
      const { emailed } = await deliver(chosen, true);
      const yourself = chosen.filter((c) => !c.hasLink || !c.emailable);
      setNote({
        text: [
          emailed ? `Emailed ${emailed} ${emailed === 1 ? "client" : "clients"}.` : "",
          yourself.length
            ? `${yourself.length === 1 ? first(yourself[0].name) : `${yourself.length} clients`} can't be emailed yet, so send them their link yourself: use Copy link or Share below.`
            : "",
        ].filter(Boolean).join(" "),
      });
    } catch (err) {
      setNote({ text: (err as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  }

  async function sendByLink() {
    const chosen = picked.map((id) => byId.get(id)!).filter(Boolean);
    setBusy("link");
    setNote(undefined);
    try {
      if (chosen.length === 1) {
        // One client: their link goes straight onto the clipboard, ready to paste into any app.
        const c = chosen[0];
        const text = deliver(chosen, false).then(({ added }) => {
          const url = new URL(c.link);
          url.searchParams.set("v", added[0].convId);
          return personalLink(url.toString(), c.teamKeyWrap, teamKey);
        });
        await writeClipboard(text);
        onLinkCopied(c.id);
        setRows((cur) => ({ ...cur, [c.id]: "copied" }));
        setNote({ text: `${first(c.name)}'s link is copied. Paste it into your own app, text or email. It only opens for ${first(c.name)}.` });
      } else {
        await deliver(chosen, false);
        setNote({ text: "Sent. Copy each client's own link below and send it from your own app. Each link only opens for that client." });
      }
    } catch (err) {
      setNote({ text: (err as Error).message || "Couldn't copy the link. Try again.", error: true });
    } finally {
      setBusy(null);
    }
  }

  async function copyRow(r: Recipient) {
    const link = links[r.convId];
    if (!link) return;
    await writeClipboard(link);
    onLinkCopied(r.clientId);
    setRows((cur) => ({ ...cur, [r.clientId]: "copied" }));
  }

  async function shareRow(r: Recipient) {
    const link = links[r.convId];
    if (!link) return;
    try {
      await navigator.share({ title: video.title, text: video.title, url: link });
      onLinkCopied(r.clientId);
      setRows((cur) => ({ ...cur, [r.clientId]: "shared" }));
    } catch {
      /* closed the share sheet */
    }
  }

  async function emailRow(r: Recipient) {
    setNote(undefined);
    const res = await fetch(`/api/videos/${r.convId}/notify`, { method: "POST" }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) return setNote({ text: data?.error ?? "Couldn't send it. Try again.", error: true });
    setRows((cur) => ({ ...cur, [r.clientId]: data.emailed === "when-ready" ? "when-ready" : "emailed" }));
  }

  async function unsend() {
    if (!primary) return;
    setNote(undefined);
    const res = await fetch(`/api/videos/${video.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: null, keyFingerprint: await fingerprint(teamKey) }),
    }).catch(() => null);
    if (!res?.ok) return setNote({ text: (await res?.json().catch(() => ({})))?.error ?? "Couldn't undo that. Try again.", error: true });
    setRecipients((cur) => cur.filter((r) => r.convId !== video.id));
    setPrimary(null);
  }

  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === "function" && matchMedia("(pointer: coarse)").matches), []);
  const label = picked.length === 0 ? (many ? "Choose clients" : "Choose a client") : picked.length === 1 ? byId.get(picked[0])?.name : `${picked.length} clients chosen`;

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
          {clients.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Add your clients first, then you can pick them here.{" "}
              <Link href="/clients" className="font-medium text-accent hover:underline">Add clients</Link>
            </p>
          ) : available.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Every client you can send to has this video.</p>
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
                        <li key={c.id} role="option" aria-selected={picked.includes(c.id)}>
                          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-hover">
                            <input type={many ? "checkbox" : "radio"} name="send-to" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
                            <span className="text-ink">{c.name}</span>
                          </label>
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
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={sendByEmail}
                  disabled={!picked.length || !!busy}
                  data-testid="send-email"
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
                >
                  {busy === "email" ? "Sending…" : "Send by email"}
                </button>
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

      {recipients.length === 0 ? (
        !isCopy && clients.length > 0 && <p className="mt-3 text-xs text-dim" data-testid="send-private">Nobody outside your team can watch this until you send it.</p>
      ) : (
        <div className={canPick ? "mt-4 border-t border-line pt-4" : ""}>
          <h3 className="text-sm font-medium text-ink">Sent to</h3>
          <ul className="mt-2 grid gap-2" data-testid="sent-list">
            {recipients.map((r) => {
              const c = byId.get(r.clientId);
              if (!c) return null;
              const blocked = c.removed || c.paused || c.linkOff || !c.link;
              const state = rows[r.clientId];
              return (
                <li key={r.convId} className="rounded-xl bg-surface-2 px-3 py-2 text-sm" data-testid="sent-row">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      {r.convId === video.id ? <span className="font-medium text-ink">{c.name}</span> : (
                        <Link href={`/v/${r.convId}`} className="font-medium text-ink hover:text-accent hover:underline">{c.name}</Link>
                      )}
                      {state && (
                        <span className="ml-2 text-xs text-ok-fg">
                          {state === "emailed" ? "Emailed" : state === "when-ready" ? "Emailed when the upload finishes" : state === "shared" ? "Shared" : "Link copied"}
                        </span>
                      )}
                    </span>
                    {!blocked && (
                      <span className="flex flex-wrap gap-1.5">
                        {c.hasLink && c.emailable && (
                          <button onClick={() => emailRow(r)} className="rounded-lg border border-line-strong px-2.5 py-1 text-xs hover:bg-hover">{state === "emailed" ? "Email again" : "Email"}</button>
                        )}
                        <button onClick={() => copyRow(r)} disabled={!links[r.convId]} data-testid="copy-row-link" className="rounded-lg border border-line-strong px-2.5 py-1 text-xs hover:bg-hover disabled:opacity-50">Copy link</button>
                        {canShare && (
                          <button onClick={() => shareRow(r)} disabled={!links[r.convId]} className="rounded-lg border border-line-strong px-2.5 py-1 text-xs hover:bg-hover disabled:opacity-50">Share</button>
                        )}
                        {r.convId === video.id && !isCopy && !hasReplies && (
                          <button onClick={unsend} className="rounded-lg px-2 py-1 text-xs text-dim hover:text-ink">Undo</button>
                        )}
                      </span>
                    )}
                  </div>
                  {c.removed ? (
                    <p className="mt-1 text-xs text-warn-fg">{c.name} was removed from your clients, so their link no longer opens this.</p>
                  ) : c.linkOff ? (
                    <p className="mt-1 text-xs text-warn-fg">SureFrame support turned off {first(c.name)}&apos;s link, so they can&apos;t open this. Contact support@sureframe.app.</p>
                  ) : c.paused ? (
                    <p className="mt-1 text-xs text-warn-fg">{c.name} is paused because your plan covers fewer clients, so they can&apos;t open this until they&apos;re restored.</p>
                  ) : !c.hasLink ? (
                    <FirstTime name={first(c.name)} />
                  ) : !c.emailable && state !== "copied" && state !== "shared" ? (
                    <p className="mt-1 text-xs text-dim">
                      {c.emailsOff ? `${first(c.name)} turned off emails from you` : `${first(c.name)} has no email address saved`}, so send them the link yourself.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A client who hasn't opened their personal link yet: the business sends it this first time. */
function FirstTime({ name }: { name: string }) {
  return (
    <details className="mt-1 text-xs text-dim" data-testid="first-time">
      <summary className="cursor-pointer">
        First time: copy {name}&apos;s link and send it yourself. After they open it once, Send by email works too. <span className="text-accent">Why?</span>
      </summary>
      <p className="mt-1">
        Your videos are end-to-end encrypted. Each client&apos;s link holds their private key, which only your team&apos;s devices have, so we can&apos;t email it without being able to see their videos. Once {name} opens it, their phone or computer remembers it.
      </p>
    </details>
  );
}
