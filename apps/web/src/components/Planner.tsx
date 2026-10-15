"use client";

import { useCallback, useEffect, useState } from "react";
import { decryptText, encryptText, fingerprint } from "@/lib/e2e/crypto";
import type { ItemDTO } from "@/lib/items";
import { browserTimeZone, DEFAULT_REMINDERS, repeatLabel, ruleLabel, sortRules, type ReminderRule } from "@/lib/schedule";
import ScheduleFields, { toLocalInput, type Schedule } from "./ScheduleFields";

type Decrypted = ItemDTO & { text: string };

export type PlannerDefaults = { reminders: ReminderRule[]; remindClient: boolean; remindTeam: boolean };
export type PlannerClient = { email: string | null; remindersOff: boolean };
/** Who "remind the team" emails, as the checkbox says it ("Email me") and as the list shows it ("you"). */
export type TeamWho = { label: string; tag: string };
const ME: TeamWho = { label: "Email me", tag: "you" };

const RepeatIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
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
  const [kind, setKind] = useState<"TASK" | "NOTE">("TASK");
  const [text, setText] = useState("");
  const [schedule, setSchedule] = useState<Schedule>(fresh);
  const [share, setShare] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();

  // Sent with re-sealed text so a write made with keys that were just reset is refused.
  const [keyFingerprint, setKeyFingerprint] = useState<string>();
  useEffect(() => {
    if (privateKey) fingerprint(privateKey).then(setKeyFingerprint, () => {});
  }, [privateKey]);

  const keyFor = useCallback((shared: boolean) => (shared ? sharedKey : privateKey), [sharedKey, privateKey]);

  const decrypt = useCallback(
    async (i: ItemDTO): Promise<Decrypted> => {
      const key = keyFor(i.shared);
      let text = "[Locked]";
      if (key) text = await decryptText(i.body, key).catch(() => "[Couldn't unlock]");
      return { ...i, text };
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
      .then(async ({ items }: { items: ItemDTO[] }) => setItems(await Promise.all(items.map(decrypt))))
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
    const shared = !!clientId && share;
    const key = keyFor(shared);
    const submitted = text;
    if (!submitted.trim() || !key) return;
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
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? "Could not save");
    setItems((cur) => [{ ...data.item, text: submitted.trim() }, ...cur]);
    // Keep anything typed while the save was in flight.
    setText((cur) => (cur === submitted ? "" : cur));
    setSchedule(fresh());
  }

  async function patch(i: Decrypted, change: Record<string, unknown>, newText = i.text) {
    const res = await fetch(`/api/items/${i.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change.body !== undefined ? { ...change, keyFingerprint } : change),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not save");
      return false;
    }
    const { item, next } = (await res.json()) as { item: ItemDTO; next: ItemDTO | null };
    setItems((cur) => {
      const list = cur.map((x) => (x.id === i.id ? { ...item, text: newText } : x));
      return next && !list.some((x) => x.id === next.id) ? [...list, { ...next, text: newText }] : list;
    });
    return true;
  }

  async function toggleShare(i: Decrypted) {
    const key = keyFor(!i.shared);
    if (!key) return;
    // Re-seal the text with the other key so the right people can read it.
    await patch(i, { shared: !i.shared, body: await encryptText(i.text, key) });
  }

  async function remove(i: Decrypted) {
    const what = i.kind === "NOTE" ? "note" : "to-do";
    const ask = i.repeat
      ? "Delete this to-do? Only this one goes: the next repeat still comes round. To stop it repeating, edit it and turn off Repeat."
      : `Delete this ${what}? This can't be undone.`;
    if (!confirm(ask)) return;
    const res = await fetch(`/api/items/${i.id}`, { method: "DELETE" });
    if (res.ok) setItems((cur) => cur.filter((x) => x.id !== i.id));
  }

  const now = Date.now();
  const open = items
    .filter((i) => i.kind === "TASK" && !i.done)
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  const notes = items.filter((i) => i.kind === "NOTE");
  const done = items.filter((i) => i.kind === "TASK" && i.done);
  const first = clientName?.split(" ")[0] ?? "client";

  const row = (i: Decrypted) =>
    editing === i.id ? (
      <li key={i.id} className="py-2.5">
        <ItemEditor
          teamLabel={teamWho.label}
          item={i}
          clientName={clientName}
          client={client}
          onCancel={() => setEditing(undefined)}
          onSave={async (newText, s) => {
            const key = keyFor(i.shared);
            if (!key) return;
            const change: Record<string, unknown> = i.kind === "TASK" ? scheduleBody(s, i.shared) : {};
            if (newText !== i.text) change.body = await encryptText(newText, key);
            if (await patch(i, change, newText)) setEditing(undefined);
          }}
        />
      </li>
    ) : (
      <li key={i.id} className="group flex items-start gap-3 py-2.5">
        {i.kind === "TASK" ? (
          <input
            type="checkbox"
            checked={i.done}
            onChange={() => patch(i, { done: !i.done })}
            aria-label={`Mark "${i.text}" ${i.done ? "not done" : "done"}`}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
        ) : (
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-line-strong" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className={`whitespace-pre-wrap text-sm ${i.done ? "text-dim line-through" : "text-ink"}`}>{i.text}</p>
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
            {i.dueAt && !i.done && i.reminders.length > 0 && ((i.remindClient && !client?.remindersOff) || i.remindTeam) && (
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
              <button onClick={() => toggleShare(i)} className={`rounded px-1.5 ${i.shared ? "bg-primary-soft text-accent" : "bg-surface-2 text-muted"} hover:underline`}>
                {i.shared ? `Shared with ${first}` : "Private to your team"}
              </button>
            )}
          </div>
        </div>
        {role === "member" && (
          // Always visible on touch screens, which have no hover.
          <div className="flex gap-2 text-xs text-dim [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
            <button onClick={() => setEditing(i.id)} aria-label={`Edit "${i.text}"`} className="hover:text-ink">
              Edit
            </button>
            <button onClick={() => remove(i)} aria-label="Delete" className="hover:text-danger-fg">
              Delete
            </button>
          </div>
        )}
      </li>
    );

  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-semibold text-ink">{title}</h2>
      {note && <p className="mt-1 text-xs text-dim">{note}</p>}
      {role === "member" && (
        <form onSubmit={add} className="mt-4 grid gap-3">
          <div role="tablist" aria-label="Item type" className="grid w-48 grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1 text-xs">
            {(["TASK", "NOTE"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
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
            className="resize-none rounded-lg border border-line-strong px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          {clientId && (
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="accent-primary" />
              Share with {first}
              <span className="text-xs text-dim">{share ? `${first} can see this` : "Only your team can see this"}</span>
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
            />
          )}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button className="ml-auto rounded-lg bg-solid px-3 py-1.5 font-medium text-white hover:bg-solid-hover">Add</button>
          </div>
          {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
        </form>
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
}: {
  teamLabel: string;
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
        <ScheduleFields value={s} onChange={setS} clientName={clientName} clientEmail={client?.email} clientOptedOut={client?.remindersOff} canShareReminders={item.shared} teamLabel={teamLabel} />
      )}
      <div className="flex justify-end gap-2 text-sm">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-muted hover:bg-hover">Cancel</button>
        <button disabled={busy} className="rounded-lg bg-solid px-3 py-1.5 font-medium text-white hover:bg-solid-hover disabled:opacity-50">Save</button>
      </div>
    </form>
  );
}
