"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PERMS, PermChecks, savePerm, type Perms } from "./StaffPerms";

type Role = "OWNER" | "ADMIN" | "MEMBER";
/** A member's own settings, shown to owners and admins so nothing a member sets is hidden from them. */
export type OwnSettings = { replyEmails: boolean; ownDefaults: boolean; message: boolean; replyTo: string | null };
export type OverviewStaff = { userId: string; name: string; email: string; role: Role; perms: Perms; own?: OwnSettings };
export type OverviewClient = { id: string; name: string; assignedToId: string | null };
type Scope = "ALL" | "SELECTED" | "MINE" | "OFF";
export type Prefs = { replyNotify: Scope; replyNotifyStaff: string[]; sentNotify: Scope; sentNotifyStaff: string[] };

const ROLE_LABEL: Record<Role, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };

/** Staff, what they can do, and who looks after which clients (with bulk reassign). */
export function Delegations({ meId, initialStaff, initialClients }: { meId: string; initialStaff: OverviewStaff[]; initialClients: OverviewClient[] }) {
  // Moving clients between people needs at least two people.
  const alone = initialStaff.length < 2;
  const [staff, setStaff] = useState(initialStaff);
  const [clients, setClients] = useState(initialClients);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>("");
  const [note, setNote] = useState<string>();
  // "Saved" on the card whose switches just changed.
  const [saved, setSaved] = useState<{ userId: string; text: string }>();
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string | null) => staff.find((s) => s.userId === id)?.name ?? "Unassigned";
  const unassigned = clients.filter((c) => !c.assignedToId || !staff.some((s) => s.userId === c.assignedToId));

  async function setPerm(s: OverviewStaff, key: keyof Perms, value: boolean) {
    setNote(undefined);
    setSaved(undefined);
    const flip = (v: boolean) => setStaff((list) => list.map((x) => (x.userId === s.userId ? { ...x, perms: { ...x.perms, [key]: v } } : x)));
    flip(value);
    const error = await savePerm(s.userId, key, value);
    if (error) {
      flip(!value);
      setNote(error);
    } else setSaved({ userId: s.userId, text: `Saved. ${s.name} ${value ? "can now" : "can no longer"} ${PERMS.find((p) => p.key === key)!.label.toLowerCase()}.` });
  }

  async function changeRole(s: OverviewStaff, role: Role) {
    setNote(undefined);
    setSaved(undefined);
    const res = await fetch(`/api/team/members/${s.userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    if (!res.ok) return setNote((await res.json().catch(() => ({}))).error ?? "Could not change the role");
    setStaff((list) => list.map((x) => (x.userId === s.userId ? { ...x, role } : x)));
    setSaved({
      userId: s.userId,
      text: role === "ADMIN" ? `Saved. ${s.name} is now an admin, with full access to every client and video.` : `Saved. ${s.name} is now a member: they see the clients assigned to them.`,
    });
  }

  async function assign() {
    setBusy(true);
    setNote(undefined);
    const assignedToId = target || null;
    const res = await fetch("/api/clients/assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientIds: [...picked], assignedToId }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNote(data.error ?? "Could not assign those clients");
    setClients((list) => list.map((c) => (picked.has(c.id) ? { ...c, assignedToId } : c)));
    setNote(`Saved. ${data.updated} ${data.updated === 1 ? "client" : "clients"} ${assignedToId ? `now with ${nameOf(assignedToId)}` : "now unassigned: the owner and admins look after them"}.`);
    setPicked(new Set());
  }

  const toggle = (id: string) => setPicked((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <div className="grid gap-6">
      <ul className="grid gap-4">
        {staff.map((s) => {
          const theirs = clients.filter((c) => c.assignedToId === s.userId);
          return (
            <li key={s.userId} className="rounded-2xl border border-line bg-surface p-5" data-testid={`staff-${s.email}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">{s.name}{s.userId === meId && " (you)"}</p>
                  <p className="text-xs text-dim">{s.email}</p>
                </div>
                {/* The role sits beside what they can do; the owner's, and your own, can't be changed here. */}
                {s.role !== "OWNER" && s.userId !== meId ? (
                  <select
                    aria-label={`Role for ${s.name}`}
                    value={s.role}
                    onChange={(e) => changeRole(s, e.target.value as Role)}
                    className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm"
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                ) : (
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">{ROLE_LABEL[s.role]}</span>
                )}
              </div>
              {s.role === "MEMBER" ? (
                <div className="mt-3">
                  <PermChecks name={s.name} email={s.email} perms={s.perms} self={false} editable onChange={(k, v) => setPerm(s, k, v)} />
                </div>
              ) : (
                <p className="mt-2 text-xs text-dim">Full access to every client and video.</p>
              )}
              {s.role === "MEMBER" && s.own && (
                <p className="mt-2 text-xs text-dim" data-testid="own-settings">
                  <OwnSettingsLine own={s.own} />
                </p>
              )}
              {saved?.userId === s.userId && (
                <p role="status" className="mt-2 text-sm text-ok-fg" data-testid="perm-saved">
                  {saved.text}
                </p>
              )}
              <p className="mt-3 text-sm text-muted" data-testid="looks-after">
                <span className="font-medium">Looks after:</span>{" "}
                {theirs.map((c, i) => (
                  <span key={c.id}>{i > 0 && ", "}<Link href={`/clients/${c.id}`} className="hover:underline">{c.name}</Link></span>
                ))}
                {/* The owner and admins look after unassigned clients, so their cards say so rather than "no clients". */}
                {s.role !== "MEMBER" && unassigned.length > 0 && (
                  <span data-testid="looks-after-unassigned">
                    {theirs.length > 0 && ", plus "}unassigned clients ({unassigned.slice(0, 5).map((c) => c.name).join(", ")}{unassigned.length > 5 ? ` and ${unassigned.length - 5} more` : ""})
                  </span>
                )}
                {!theirs.length && (s.role === "MEMBER" || !unassigned.length) && <span className="text-dim">no clients yet</span>}
              </p>
            </li>
          );
        })}
      </ul>

      {!alone && (
      <section className="rounded-2xl border border-line bg-surface p-5" data-testid="reassign">
        <h3 className="font-semibold text-ink">Reassign clients</h3>
        <p className="mt-1 text-xs text-dim">Tick clients, then choose who looks after them. Members only see the clients assigned to them, unless they can see all clients. Unassigned clients are looked after by the owner and admins.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <button type="button" onClick={() => setPicked(new Set(clients.filter((c) => !c.assignedToId).map((c) => c.id)))} className="rounded-full border border-line-strong px-3 py-1 hover:bg-hover">Pick unassigned</button>
          <button type="button" onClick={() => setPicked(new Set(clients.map((c) => c.id)))} className="rounded-full border border-line-strong px-3 py-1 hover:bg-hover">Pick all</button>
          {picked.size > 0 && <button type="button" onClick={() => setPicked(new Set())} className="rounded-full px-3 py-1 text-dim hover:text-ink">Clear</button>}
        </div>
        <ul className="mt-3 grid max-h-72 gap-1 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2">
          {clients.map((c) => (
            <li key={c.id}>
              <label className="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm hover:bg-hover">
                <span className="flex items-center gap-2">
                  <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Pick ${c.name}`} />
                  {c.name}
                </span>
                <span className="text-xs text-dim">{nameOf(c.assignedToId)}</span>
              </label>
            </li>
          ))}
          {clients.length === 0 && <li className="px-2 py-1 text-sm text-dim">No clients yet.</li>}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Assign picked clients to" className="rounded-lg border border-line-strong bg-surface px-2 py-1.5">
            <option value="">Unassigned (owner and admins)</option>
            {staff.map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
          </select>
          <button type="button" onClick={assign} disabled={busy || picked.size === 0} className="rounded-lg bg-primary px-4 py-1.5 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
            Assign {picked.size || ""} {picked.size === 1 ? "client" : "clients"}
          </button>
        </div>
      </section>
      )}
      {note && <p role="status" className="text-sm text-muted">{note}</p>}
    </div>
  );
}

/** What a member set for themselves, said once, with everything else as "the business's settings" (S68). */
function OwnSettingsLine({ own }: { own: OwnSettings }) {
  const theirs = [own.ownDefaults && "reminder defaults", own.message && "message on client emails", own.replyTo && `reply-to address (${own.replyTo})`].filter(Boolean) as string[];
  const list = theirs.length > 1 ? `${theirs.slice(0, -1).join(", ")} and ${theirs.at(-1)}` : theirs[0];
  return (
    <>
      Reply emails {own.replyEmails ? "on" : "off"}.{" "}
      {!theirs.length
        ? "Reminders and client emails use the business's settings."
        : `Their own ${list}${theirs.length < 3 ? "; the rest uses the business's settings" : ""}.`}
    </>
  );
}

const SCOPES: { value: Scope; label: string }[] = [
  { value: "ALL", label: "All staff" },
  { value: "SELECTED", label: "Only selected staff" },
  { value: "MINE", label: "Only my own clients" },
  { value: "OFF", label: "Off" },
];

/** The owner's or admin's own email preferences. */
/** A radio option drawn as a pill, so the chosen one is plain to see (not just a small dot). */
function Choice({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: React.ReactNode }) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 ${checked ? "border-primary bg-primary-soft font-semibold text-ink" : "border-line-strong text-muted hover:bg-hover"}`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="accent-primary" />
      {children}
      {checked && <span className="sr-only"> (selected)</span>}
    </label>
  );
}

export function NotifyPrefs({ meId, staff, initial }: { meId: string; staff: OverviewStaff[]; initial: Prefs }) {
  const [prefs, setPrefs] = useState(initial);
  const [saved, setSaved] = useState<string>();
  const others = staff.filter((s) => s.userId !== meId);
  const quiet = others.filter((s) => s.role === "MEMBER" && s.own && !s.own.replyEmails);

  async function save(next: Prefs) {
    setPrefs(next);
    setSaved(undefined);
    const res = await fetch("/api/team/prefs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    setSaved(res.ok ? "Saved." : "Couldn't save. Try again.");
  }
  const toggleIn = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));

  return (
    <div className="grid gap-5 rounded-2xl border border-line bg-surface p-5 text-sm">
      <fieldset>
        <legend className="font-medium text-ink">Client replies</legend>
        <p className="text-xs text-dim">You always hear about your own clients unless this is off. Staff hear about replies from their clients unless they turned that off for themselves.</p>
        {quiet.length > 0 && (
          <p className="mt-1 text-xs text-warn-fg" data-testid="quiet-staff">
            {quiet.map((s) => s.name).join(", ")} turned off reply emails for their clients. Pick All staff or select them to hear about those replies yourself.
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-3">
          {SCOPES.map((s) => (
            <Choice key={s.value} name="replyNotify" checked={prefs.replyNotify === s.value} onChange={() => save({ ...prefs, replyNotify: s.value })}>
              {s.label}
            </Choice>
          ))}
        </div>
        {prefs.replyNotify === "SELECTED" && (
          <div className="mt-2 flex flex-wrap gap-3 rounded-lg bg-canvas px-3 py-2">
            {others.map((s) => (
              <label key={s.userId} className="flex items-center gap-1.5">
                <input type="checkbox" checked={prefs.replyNotifyStaff.includes(s.userId)} onChange={(e) => save({ ...prefs, replyNotifyStaff: toggleIn(prefs.replyNotifyStaff, s.userId, e.target.checked) })} aria-label={`Replies to ${s.name}'s clients`} />
                {s.name}&apos;s clients
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <fieldset>
        <legend className="font-medium text-ink">Videos sent by staff</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {SCOPES.map((s) => (
            <Choice key={s.value} name="sentNotify" checked={prefs.sentNotify === s.value} onChange={() => save({ ...prefs, sentNotify: s.value })}>
              {s.value === "MINE" ? "Only to my own clients" : s.label}
            </Choice>
          ))}
        </div>
        {prefs.sentNotify === "SELECTED" && (
          <div className="mt-2 grid gap-1.5 rounded-lg bg-canvas px-3 py-2">
            {others.map((s) => (
              <label key={s.userId} className="flex items-center gap-1.5">
                <input type="checkbox" checked={prefs.sentNotifyStaff.includes(s.userId)} onChange={(e) => save({ ...prefs, sentNotifyStaff: toggleIn(prefs.sentNotifyStaff, s.userId, e.target.checked) })} aria-label={`Tell me when ${s.name} sends a video`} />
                Tell me when {s.name} sends a video
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <p className="text-xs text-dim">
        Emails are combined: at most one every 15 minutes per conversation or staff member. They never include replies or video titles. Deletion warnings,
        requests for a personal link and account notices always come.
      </p>
      {saved && <p role="status" className="text-xs text-muted">{saved}</p>}
    </div>
  );
}

/** Send a short reminder to one, several or all staff. */
export function StaffReminderForm({ meId, staff, clients, videos }: { meId: string; staff: OverviewStaff[]; clients: OverviewClient[]; videos: { id: string; title: string }[] }) {
  const router = useRouter();
  const others = staff.filter((s) => s.userId !== meId);
  const [to, setTo] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(undefined);
    const [kind, id] = link.split(":");
    const res = await fetch("/api/team/notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: to.size === others.length ? "all" : [...to], message, link: link ? { kind, id } : undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNote(data.error ?? "Could not send the reminder");
    setNote(`Sent to ${data.sent} ${data.sent === 1 ? "person" : "people"}. It's listed under Sent reminders.`);
    router.refresh();
    setMessage("");
    setLink("");
    setTo(new Set());
  }

  if (!others.length) {
    return (
      <p className="rounded-2xl border border-line bg-surface p-5 text-sm text-dim">
        Once someone else is on the team, you can send them reminders here. <Link href="/settings/team" className="font-medium text-accent hover:underline">Invite staff</Link>
      </p>
    );
  }
  // Why Send isn't ready yet, said next to it.
  // Both at once when both are missing, so picking someone doesn't look like it did nothing (S61).
  const missing = !to.size && !message.trim() ? "Pick who to remind and write a message." : !to.size ? "Pick who to remind." : !message.trim() ? "Write a message." : null;
  return (
    <form onSubmit={send} className="grid gap-3 rounded-2xl border border-line bg-surface p-5 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-ink">To</span>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={to.size === others.length} onChange={(e) => setTo(e.target.checked ? new Set(others.map((s) => s.userId)) : new Set())} />
          Everyone
        </label>
        {others.map((s) => (
          <label key={s.userId} className="flex items-center gap-1.5">
            <input type="checkbox" checked={to.has(s.userId)} onChange={(e) => setTo((cur) => { const next = new Set(cur); if (e.target.checked) next.add(s.userId); else next.delete(s.userId); return next; })} aria-label={`Remind ${s.name}`} />
            {s.name}
          </label>
        ))}
      </div>
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={500} rows={2} placeholder="e.g. Please check in with your clients before Friday." aria-label="Reminder message" className="rounded-lg border border-line-strong px-3 py-2" />
      <div className="flex flex-wrap items-center gap-2">
        <select value={link} onChange={(e) => setLink(e.target.value)} aria-label="Link to" className="max-w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5">
          <option value="">No link</option>
          <optgroup label="Clients">
            {clients.map((c) => <option key={c.id} value={`client:${c.id}`}>{c.name}</option>)}
          </optgroup>
          <optgroup label="Recent videos">
            {videos.map((v) => <option key={v.id} value={`video:${v.id}`}>{v.title}</option>)}
          </optgroup>
        </select>
        <button disabled={busy || !!missing} className="rounded-lg bg-primary px-4 py-1.5 font-semibold text-on-primary hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted">Send reminder</button>
        {missing && <span className="text-xs text-dim" data-testid="remind-missing">{missing}</span>}
      </div>
      <p className="text-xs text-dim">They get an email and see it in the app until they dismiss it.</p>
      {note && <p role="status" className="text-muted">{note}</p>}
    </form>
  );
}
