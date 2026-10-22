"use client";

export type Perms = { seeAllClients: boolean; addClients: boolean; deleteAnyVideo: boolean; sendToMany: boolean };

/**
 * What each switch lets a member do. Owners and admins can always do all of it. `hint` is written about the
 * member, for the owner's and admins' pages; `own` is the same, said to the member on their own page.
 */
export const PERMS: { key: keyof Perms; label: string; hint: string; own: string }[] = [
  {
    key: "seeAllClients",
    label: "See all clients",
    hint: "Every client, including unassigned ones, with their videos, replies and to-dos. Off: only clients assigned to them.",
    own: "Every client, including unassigned ones, with their videos, replies and to-dos. Off: only clients assigned to you.",
  },
  { key: "addClients", label: "Add new clients", hint: "New clients they add are assigned to them.", own: "New clients you add are assigned to you." },
  { key: "deleteAnyVideo", label: "Delete any video", hint: "Off: they can delete only videos they recorded.", own: "Off: you can delete only videos you recorded." },
  { key: "sendToMany", label: "Send to many", hint: "Send one video to several of the clients they can see.", own: "Send one video to several of the clients you can see." },
];

/** "add new clients and send to many", for a list of switches. */
export const permNames = (keys: (keyof Perms)[], joiner = "and") => {
  const names = keys.map((k) => PERMS.find((p) => p.key === k)!.label.toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ${joiner} ${names.at(-1)}` : (names[0] ?? "");
};

/** Save one permission for a member; resolves to an error message or null. */
export async function savePerm(userId: string, key: keyof Perms, value: boolean) {
  const res = await fetch(`/api/team/members/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ perms: { [key]: value } }) });
  return res.ok ? null : ((await res.json().catch(() => ({}))).error ?? "Could not change what they can do");
}

/** The permission checkboxes for one member, with a note of what they see. */
export function PermChecks({ name, email, perms, self, editable, onChange }: { name: string; email: string; perms: Perms; self: boolean; editable: boolean; onChange?: (key: keyof Perms, value: boolean) => void }) {
  return (
    <fieldset className="w-full rounded-xl bg-canvas px-4 py-3" data-testid={`perms-${email}`}>
      <legend className="sr-only">What {name} can do</legend>
      <p className="text-xs text-muted">
        {self ? "You see" : `${name} sees`} the clients assigned to {self ? "you" : "them"} (with their videos, replies, to-dos and notes) and videos {self ? "you" : "they"} recorded.
        {" "}Only the owner and admins remove clients, invite staff or change these.
        {!editable && self && " The ticks show what you can do; you can't change them here."}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {PERMS.map((p) => (
          <label key={p.key} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={perms[p.key]} disabled={!editable} onChange={(e) => onChange?.(p.key, e.target.checked)} aria-label={self ? p.label : `${p.label} for ${name}`} />
            <span>
              <span className="font-medium text-ink">
                {p.label}
                {!editable && <span className="ml-1.5 text-xs font-normal text-dim">{perms[p.key] ? "(on)" : "(off)"}</span>}
              </span>
              <span className="block text-xs text-dim">{self ? p.own : p.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
