"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decryptText, encryptText, fingerprint } from "@/lib/e2e/crypto";
import type { ItemDTO } from "@/lib/items";
import { browserTimeZone, DEFAULT_REMINDERS, repeatLabel, ruleLabel, sortRules, type ReminderRule } from "@/lib/schedule";
import ScheduleFields, { toLocalInput, type Schedule } from "./ScheduleFields";
import ConfirmDialog from "./ConfirmDialog";

/** `locked`: this browser couldn't open it, so `text` is a placeholder and must never be sealed and saved over the real words. */
type Decrypted = ItemDTO & { text: string; locked?: boolean };

export type PlannerDefaults = { reminders: ReminderRule[]; remindClient: boolean; remindTeam: boolean };
export type PlannerClient = { email: string | null; remindersOff: boolean };
/** Who "remind the team" emails, as the checkbox says it ("Email me") and as the list shows it ("you"). */
export type TeamWho = { label: string; tag: string };
const ME: TeamWho = { label: "Email me", tag: "you" };
/** For the team, on an item this browser couldn't open: why it has no Edit or Share. */
const LOCKED_NOTE = "This one couldn't be unlocked in this browser, so it can't be changed here.";

const RepeatIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
);
const LockIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);
const EyeIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
);
const BellIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
);

/**
 * To-dos, notes, due dates, repeats and reminders, end-to-end encrypted.
 * Members see everything; a client sees and can tick off only what is
 * shared with them.
 *
 * privateKey seals items only the team can read (members only).
 * sharedKey seals items shared with the client (the client's key).
 */
export default function Planner({
  role,
  clientId,
  clientName,
  client,
  defaults,
  privateKey,
  sharedKey,
  title = "Tasks & notes",
  note,
  teamWho = ME,
  hideWhenEmpty = false,
}: {
  role: "member" | "client";
  clientId: string | null;
  clientName?: string;
  client?: PlannerClient;
  defaults?: PlannerDefaults;
  privateKey: CryptoKey | null;
  sharedKey: CryptoKey | null;
  title?: string;
  /** A line under the title, e.g. who else can see the list. */
  note?: string;
  teamWho?: TeamWho;
  /** Draw nothing until there's something in the list (a client's video page, where an empty card would be noise). */
  hideWhenEmpty?: boolean;
}) {
  const fresh = useCallback(
    (): Schedule => ({
      due: "",
      repeat: null,
      reminders: defaults?.reminders ?? DEFAULT_REMINDERS,
      remindClient: defaults?.remindClient ?? true,
      remindTeam: defaults?.remindTeam ?? false,
    }),
    [defaults],
  );
  const [items, setItems] = useState<Decrypted[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // The business's time zone (team only, sent with the list): repeats are counted in it, not in this device's zone.
  const [tz, setTz] = useState<string | null>();
  // A save from the Add form is under way: a second press mustn't save the same item again.
  const [adding, setAdding] = useState(false);
  const addingNow = useRef(false);
  const [kind, setKind] = useState<"TASK" | "NOTE">("TASK");
  const [text, setText] = useState("");
  const [schedule, setSchedule] = useState<Schedule>(fresh);
  const [share, setShare] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();
  // Sharing asks first (a private note about a client must not reach them by a stray click); making private doesn't.
  const [asking, setAsking] = useState<Decrypted>();
  // The share strip takes focus when it opens, so keyboard and screen-reader users land on the question.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (asking) stripRef.current?.focus();
  }, [asking]);
  const [deleting, setDeleting] = useState<Decrypted>();
  const [busy, setBusy] = useState(false);
  // The last share change, with an Undo.
  const [changed, setChanged] = useState<{ id: string; shared: boolean; text: string }>();

  // Sent with re-sealed text so a write made with keys that were just reset is refused.
  const [keyFingerprint, setKeyFingerprint] = useState<string>();
  useEffect(() => {
    if (privateKey) fingerprint(privateKey).then(setKeyFingerprint, () => {});
  }, [privateKey]);

  const keyFor = useCallback((shared: boolean) => (shared ? sharedKey : privateKey), [sharedKey, privateKey]);

  const decrypt = useCallback(
    async (i: ItemDTO): Promise<Decrypted> => {
      const key = keyFor(i.shared);
      if (!key) return { ...i, text: "[Locked]", locked: true };
      const text = await decryptText(i.body, key).catch(() => null);
      return text === null ? { ...i, text: "[Couldn't unlock]", locked: true } : { ...i, text };
    },
    [keyFor],
  );

  useEffect(() => {
    const q = clientId ? `?clientId=${clientId}` : "";
    setLoadError(false);
    fetch(`/api/items${q}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(async ({ items, tz }: { items: ItemDTO[]; tz?: string | null }) => {
        setTz(tz);
        setItems(await Promise.all(items.map(decrypt)));
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoaded(true));
  }, [clientId, decrypt]);

  const scheduleBody = (s: Schedule, shared: boolean) => ({
    dueAt: s.due ? new Date(s.due).toISOString() : null,
    repeat: s.due ? s.repeat : null,
    reminders: s.due ? s.reminders : [],
    // Kept even while the client has emails off: they're checked when sent, so reminders resume if the client turns emails back on.
    remindClient: shared && s.remindClient && !!client?.email,
    remindTeam: s.remindTeam,
    tz: browserTimeZone(),
  });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    // One at a time: a double press on Add, or Enter twice, would save the item twice (and remind a client twice).
    if (addingNow.current) return;
    addingNow.current = true;
    setAdding(true);
    try {
      await addItem();
    } finally {
      addingNow.current = false;
      setAdding(false);
    }
  }

  async function addItem() {
    const shared = !!clientId && share;
    const key = keyFor(shared);
    const submitted = text;
    if (!submitted.trim()) return;
    // The team's key is always here (the page asks for it first); a client's key can fail to open in this browser.
    if (!key) return setError(shared ? `${who}'s key didn't unlock in this browser, so this can't be shared with them here. Reload the page, or add it privately.` : "This browser doesn't have your team's key yet. Reload the page and try again.");
    setError(undefined);
    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        body: await encryptText(submitted.trim(), key),
        clientId,
        shared,
        keyFingerprint,
        ...(kind === "TASK" ? scheduleBody(schedule, shared) : {}),
      }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) ?? {};
    if (!res?.ok) return setError(data.error ?? "Couldn't save. Check your connection and try again.");
    setItems((cur) => [{ ...data.item, text: submitted.trim() }, ...cur]);
    // Keep anything typed while the save was in flight.
    setText((cur) => (cur === submitted ? "" : cur));
    setSchedule(fresh());
    // Sharing is chosen each time, so the next item (often a private note) never goes to the client by mistake.
    setShare(false);
  }

  async function patch(i: Decrypted, change: Record<string, unknown>, newText = i.text) {
    const res = await fetch(`/api/items/${i.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change.body !== undefined ? { ...change, keyFingerprint } : change),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { item: ItemDTO; next: ItemDTO | null; error?: string } | null;
    if (!res?.ok || !data?.item) {
      // A client (who can only tick) is told plainly under their list; the API's own words ("Not found") are for the team.
      setError(role === "client" && res ? "That didn't save. Refresh the page and try again." : (data?.error ?? "Couldn't save. Check your connection and try again."));
      return false;
    }
    if (role === "client") setError(undefined);
    const { item, next } = data;
    setItems((cur) => {
      // An item that didn't unlock stays marked so (unless its text was just rewritten), as does its next repeat.
      const locked = i.locked && newText === i.text;
      const list = cur.map((x) => (x.id === i.id ? { ...item, text: newText, locked } : x));
      return next && !list.some((x) => x.id === next.id) ? [...list, { ...next, text: newText, locked }] : list;
    });
    return true;
  }

  async function setShared(i: Decrypted, shared: boolean) {
    const key = keyFor(shared);
    if (!key) return false;
    // Its text here is only a placeholder: sealing that with the other key would replace the real words for good.
    if (i.locked) {
      setError(LOCKED_NOTE);
      return false;
    }
    // Re-seal the text with the other key so the right people can read it.
    const ok = await patch(i, { shared, body: await encryptText(i.text, key) });
    if (ok) setChanged({ id: i.id, shared, text: i.text });
    return ok;
  }

  async function confirmShare() {
    if (!asking) return;
    setBusy(true);
    setError(undefined);
    if (await setShared(asking, true)) setAsking(undefined);
    setBusy(false);
  }

  async function undo() {
    const i = changed && items.find((x) => x.id === changed.id);
    if (!i) return setChanged(undefined);
    // Undoing a share is making it private again, which needs no question.
    if (await setShared(i, !changed.shared)) setChanged(undefined);
  }

  async function remove(i: Decrypted) {
    setBusy(true);
    const res = await fetch(`/api/items/${i.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError("Couldn't delete it. Check your connection and try again.");
    setItems((cur) => cur.filter((x) => x.id !== i.id));
    setDeleting(undefined);
  }

  const now = Date.now();
  const open = items
    .filter((i) => i.kind === "TASK" && !i.done)
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  const notes = items.filter((i) => i.kind === "NOTE");
  const done = items.filter((i) => i.kind === "TASK" && i.done);
  const first = clientName?.split(" ")[0] ?? "client";
  const who = clientName ?? "the client";

  /** Asks before sharing, in a strip under the item (like Stop sharing on the video page), not a pop-up (D12e). */
  const shareStrip = (i: Decrypted) => (
    <div
      ref={stripRef}
      tabIndex={-1}
      role="group"
      aria-label={`Share "${i.text}" with ${who}?`}
      data-testid="share-confirm"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.stopPropagation();
          setAsking(undefined);
          setError(undefined);
        }
      }}
      className="mt-2 rounded-lg border border-warn-line bg-warn-bg p-3 text-xs text-muted outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <p className="font-medium text-ink">Share this {i.kind === "NOTE" ? "note" : "to-do"} with {who}?</p>
      <p className="mt-1">
        {who} will see it on their page{i.kind === "TASK" ? " and can tick it off" : ""}. Your other private to-dos and notes stay private. You can undo this straight after, or make it private again later.
      </p>
      {error && (
        <p role="alert" className="mt-1 font-medium text-danger-fg">
          {error}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={confirmShare} disabled={busy} data-testid="share-confirm-yes" className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
          {busy ? "Sharing…" : `Share with ${who}`}
        </button>
        <button
          onClick={() => {
            setAsking(undefined);
            setError(undefined);
          }}
          disabled={busy}
          className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-surface-2"
        >
          Keep it private
        </button>
      </div>
    </div>
  );

  const row = (i: Decrypted) =>
    editing === i.id ? (
      <li key={i.id} className="py-2.5">
        <ItemEditor
          teamLabel={teamWho.label}
          tz={tz}
          item={i}
          clientName={clientName}
          client={client}
          onCancel={() => setEditing(undefined)}
          onSave={async (newText, s) => {
            const key = keyFor(i.shared);
            // No Edit is offered for an item that didn't unlock; this guards the same thing.
            if (!key || i.locked) return;
            const change: Record<string, unknown> = i.kind === "TASK" ? scheduleBody(s, i.shared) : {};
            if (newText !== i.text) change.body = await encryptText(newText, key);
            if (await patch(i, change, newText)) setEditing(undefined);
          }}
        />
      </li>
    ) : (
      <li key={i.id} className="group py-2.5">
        <div className="flex items-start gap-3">
          {i.kind === "TASK" ? (
            <input
              type="checkbox"
              id={`todo-${i.id}`}
              checked={i.done}
              onChange={() => patch(i, { done: !i.done })}
              aria-label={`Mark "${i.text}" ${i.done ? "not done" : "done"}`}
              // A finger-sized box for clients, who are mostly on phones and only ever tick.
              className={`shrink-0 accent-primary ${role === "client" ? "h-5 w-5" : "mt-0.5 h-4 w-4"}`}
            />
          ) : (
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-line-strong" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            {role === "client" && i.kind === "TASK" ? (
              // For a client the words tick it too, so the whole line is the target.
              <label htmlFor={`todo-${i.id}`} className={`block whitespace-pre-wrap text-sm ${i.done ? "text-dim line-through" : "text-ink"}`}>{i.text}</label>
            ) : (
              <p className={`whitespace-pre-wrap text-sm ${i.done ? "text-dim line-through" : "text-ink"}`}>{i.text}</p>
            )}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-dim">
              {i.dueAt && (
                <span className={!i.done && new Date(i.dueAt).getTime() < now ? "font-medium text-danger-fg" : ""}>
                  Due {new Date(i.dueAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
              )}
              {i.repeat && (
                <span className="inline-flex items-center gap-1" title="Repeats">
                  <RepeatIcon /> {repeatLabel(i.repeat)}
                </span>
              )}
              {/* A client sees the bell only for emails that will really come to them: never the team's own reminders. */}
              {i.dueAt && !i.done && i.reminders.length > 0 && ((i.remindClient && !client?.remindersOff) || (role === "member" && i.remindTeam)) && (
                <span className="inline-flex items-center gap-1" title="Email reminders">
                  <BellIcon /> {sortRules(i.reminders).map(ruleLabel).join(", ")}
                  {role === "member" && (
                    <span className="text-dim">
                      {" "}
                      {/* A client who turned emails off isn't sent one, though the to-do keeps asking for when they turn them back on. */}
                      · {[i.remindClient && !client?.remindersOff && first, i.remindTeam && teamWho.tag].filter(Boolean).join(" and ")}
                    </span>
                  )}
                </span>
              )}
              {role === "member" && clientId && (
                // A label, not a button: changing who sees it is the Share / Make private action beside Edit.
                <span data-testid="share-state" className={`inline-flex items-center gap-1 rounded px-1.5 ${i.shared ? "bg-primary-soft text-accent" : "bg-surface-2 text-muted"}`}>
                  {i.shared ? <EyeIcon /> : <LockIcon />}
                  {i.shared ? `Shared with ${who}` : "Private to your team"}
                </span>
              )}
              {role === "member" && i.locked && <span data-testid="item-locked">{LOCKED_NOTE}</span>}
            </div>
          </div>
          {role === "member" && (
            // Always visible on touch screens, which have no hover.
            <div className="flex gap-2 text-xs text-dim [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
              {/* Not for an item that didn't unlock: Edit or a share change would seal the placeholder over the real words. */}
              {!i.locked && (
                <button onClick={() => setEditing(i.id)} aria-label={`Edit "${i.text}"`} className="hover:text-ink">
                  Edit
                </button>
              )}
              {clientId &&
                !i.locked &&
                (i.shared ? (
                  <button onClick={() => setShared(i, false)} aria-label={`Make "${i.text}" private`} className="hover:text-ink">
                    Make private
                  </button>
                ) : (
                  <button onClick={() => setAsking(i)} aria-label={`Share "${i.text}" with ${who}`} className="hover:text-ink">
                    Share…
                  </button>
                ))}
              {/* An old "couldn't save" mustn't show inside the box this opens. */}
              <button
                onClick={() => {
                  setError(undefined);
                  setDeleting(i);
                }}
                aria-label={`Delete ${i.kind === "NOTE" ? "note" : "to-do"}: ${i.text.slice(0, 40)}`}
                className="hover:text-danger-fg"
              >
                Delete
              </button>
            </div>
          )}
        </div>
        {asking?.id === i.id && shareStrip(asking)}
      </li>
    );

  if (hideWhenEmpty && (!loaded || loadError || items.length === 0)) return null;
  return (
    <section className="rounded-2xl border border-line bg-surface p-5" data-testid="planner">
      <h2 className="font-semibold text-ink">{title}</h2>
      {note && <p className="mt-1 text-xs text-dim">{note}</p>}
      {role === "member" && (
        <form onSubmit={add} className="mt-4 grid gap-3">
          {/* A choice of what to add, not tabs (O77): a radio group, with the arrow keys moving between the two. */}
          <div
            role="radiogroup"
            aria-label="Add a to-do or a note"
            className="grid w-48 grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1 text-xs"
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
              e.preventDefault();
              const next = kind === "TASK" ? "NOTE" : "TASK";
              setShare(false);
              setKind(next);
              (e.currentTarget.querySelector(`[data-kind=${next}]`) as HTMLElement | null)?.focus();
            }}
          >
            {(["TASK", "NOTE"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                tabIndex={kind === k ? 0 : -1}
                data-kind={k}
                onClick={() => {
                  if (k !== kind) setShare(false);
                  setKind(k);
                }}
                className={`rounded-md px-2 py-1 font-medium ${kind === k ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
              >
                {k === "TASK" ? "To-do" : "Note"}
              </button>
            ))}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={kind === "NOTE" ? 3 : 1}
            placeholder={kind === "TASK" ? "Add a to-do…" : "Write a note…"}
            aria-label={kind === "TASK" ? "New to-do" : "New note"}
            className="resize-none rounded-lg border border-line-strong px-3 py-2 text-sm focus:border-primary"
          />
          {clientId && (
            // Off unless ticked for this item: shared is the exception, and it's plain which one this is.
            <label
              data-testid="share-choice"
              data-shared={share ? "true" : undefined}
              className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm ${share ? "border-primary bg-primary-soft text-ink" : "border-line bg-surface-2 text-muted"}`}
            >
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="accent-primary" />
              Share with {who}
              <span className={`text-xs ${share ? "font-medium text-accent" : "text-dim"}`}>
                {share ? `${who} will see this ${kind === "NOTE" ? "note" : "to-do"}` : `Private: only your team will see this ${kind === "NOTE" ? "note" : "to-do"}`}
              </span>
            </label>
          )}
          {kind === "TASK" && (
            <ScheduleFields
              value={schedule}
              onChange={setSchedule}
              clientName={clientName}
              clientEmail={client?.email}
              clientOptedOut={client?.remindersOff}
              canShareReminders={!!clientId && share}
              teamLabel={teamWho.label}
              tz={tz}
            />
          )}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button disabled={adding} className="ml-auto rounded-lg bg-solid px-3 py-1.5 font-medium text-white hover:bg-solid-hover disabled:opacity-50">{clientId ? (share ? `Add and share with ${who}` : "Add privately") : "Add"}</button>
          </div>
          {error && !asking && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
        </form>
      )}

      {changed && items.some((x) => x.id === changed.id) && (
        <p role="status" data-testid="share-undo" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-muted">
          <span className="min-w-0 break-words">
            {changed.shared ? `Shared with ${who}: “${changed.text}”. They can see it on their page now.` : `Private again: “${changed.text}”. Only your team sees it.`}
          </span>
          <span className="ml-auto flex gap-3">
            <button onClick={undo} className="font-medium text-accent hover:underline">Undo</button>
            <button onClick={() => setChanged(undefined)} aria-label="Dismiss" className="text-dim hover:text-ink">✕</button>
          </span>
        </p>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete this ${deleting.kind === "NOTE" ? "note" : "to-do"}?`}
          body={
            <>
              <p className="break-words font-medium text-ink">“{deleting.text}”</p>
              <p>{deleting.repeat && !deleting.done ? "Only this one goes: the next repeat still comes round. To stop it repeating, edit it and turn off Repeat." : "This can't be undone."}</p>
            </>
          }
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          busy={busy}
          error={error}
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(undefined)}
          testId="delete-confirm"
        />
      )}
      {!loaded ? (
        <p className="mt-4 text-sm text-dim">Loading…</p>
      ) : loadError ? (
        <p role="alert" className="mt-4 text-sm text-danger-fg">Couldn&apos;t load this list. Refresh the page to try again.</p>
      ) : items.length === 0 ? (
        <p className="mt-4 text-sm text-dim">{role === "client" ? "Nothing shared with you yet." : "Nothing here yet."}</p>
      ) : (
        <div className="mt-4 divide-y divide-line">
          {open.length > 0 && (
            <div className="pb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-dim">To do</h3>
              <ul>{open.map(row)}</ul>
            </div>
          )}
          {notes.length > 0 && (
            <div className="py-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-dim">Notes</h3>
              <ul>{notes.map(row)}</ul>
            </div>
          )}
          {done.length > 0 && (
            <div className="pt-2">
              <button onClick={() => setShowDone((v) => !v)} className="text-xs font-semibold uppercase tracking-wide text-dim hover:text-ink">
                Done ({done.length}) {showDone ? "▾" : "▸"}
              </button>
              {showDone && <ul>{done.map(row)}</ul>}
            </div>
          )}
        </div>
      )}
      {/* A client has no form to show it in: a tick that didn't save says so here. */}
      {error && role === "client" && (
        <p role="alert" className="mt-2 text-sm text-danger-fg" data-testid="todo-error">
          {error}
        </p>
      )}
    </section>
  );
}

function ItemEditor({
  item,
  clientName,
  client,
  onSave,
  onCancel,
  teamLabel,
  tz,
}: {
  teamLabel: string;
  /** The business's time zone, for the repeat picker. */
  tz?: string | null;
  item: Decrypted;
  clientName?: string;
  client?: PlannerClient;
  onSave: (text: string, s: Schedule) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const [s, setS] = useState<Schedule>({
    due: toLocalInput(item.dueAt),
    repeat: item.repeat,
    reminders: item.reminders,
    remindClient: item.remindClient,
    remindTeam: item.remindTeam,
  });
  return (
    <form
      className="grid gap-3 rounded-xl bg-canvas p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        await onSave(text.trim(), s);
        setBusy(false);
      }}
    >
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={item.kind === "NOTE" ? 3 : 1} aria-label="Edit text" className="resize-none rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" />
      {item.kind === "TASK" && (
        <ScheduleFields value={s} onChange={setS} clientName={clientName} clientEmail={client?.email} clientOptedOut={client?.remindersOff} canShareReminders={item.shared} teamLabel={teamLabel} tz={tz} />
      )}
      <div className="flex justify-end gap-2 text-sm">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-muted hover:bg-hover">Cancel</button>
        <button disabled={busy} className="rounded-lg bg-solid px-3 py-1.5 font-medium text-white hover:bg-solid-hover disabled:opacity-50">Save</button>
      </div>
    </form>
  );
}
