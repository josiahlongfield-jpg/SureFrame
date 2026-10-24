"use client";

import { useEffect, useRef, useState } from "react";
import { decryptFrames, unwrapKey } from "@/lib/e2e/crypto";
import { DialogButtons, DialogShell, dangerButton, quietButton, secondaryButton } from "./ConfirmDialog";

type Video = { id: string; title: string | null; createdAt: string; mimeType: string; durationMs: number | null; encrypted: boolean; teamKeyWrap: string | null; saveable: boolean; url: string };
type Preview = { client: { id: string; name: string; email: string | null }; willEmail: boolean; videos: Video[]; kept: number; replies: number; items: number };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const fileName = (...parts: string[]) => parts.map((p) => p.replace(/[^\w\- ]+/g, "").trim()).filter(Boolean).join(" - ") || "recording";
const madeOn = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Saves one recording to this device, opened here with the team's key (nothing readable goes to the server). */
async function save(v: Video, teamKey: CryptoKey | null, business: string, client: string) {
  const res = await fetch(v.url);
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.arrayBuffer();
  let parts: BlobPart[] = [data];
  if (v.encrypted) {
    if (!teamKey || !v.teamKeyWrap) throw new Error("locked");
    parts = (await decryptFrames(data, await unwrapKey(v.teamKeyWrap, teamKey))) as BlobPart[];
  }
  const type = v.mimeType.split(";")[0];
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${fileName(business, client, v.title ?? madeOn(v.createdAt))}.${type.includes("mp4") ? "mp4" : "webm"}` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * "Remove client" (Josiah, 24 October 2026): deleting a client is permanent and
 * immediate. The box says everything that's erased, offers to save the
 * recordings sent only to them first, and needs a tick before the button works.
 */
export default function DeleteClientDialog({
  clientId,
  name,
  business,
  teamKey,
  onDeleted,
  onClose,
}: {
  clientId: string;
  name: string;
  business: string;
  /** Null while this browser doesn't hold the team's key: encrypted recordings can't be opened to save them. */
  teamKey: CryptoKey | null;
  onDeleted: (result: { emailed: boolean }) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<Preview>();
  const [loadError, setLoadError] = useState<string>();
  const [sure, setSure] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string>();
  // Saving: how many are done, and which couldn't be saved.
  const [saving, setSaving] = useState<{ done: number; failed: string[]; finished: boolean } | null>(null);
  const savingNow = !!saving && !saving.finished;
  const stop = useRef(false);

  useEffect(() => {
    let gone = false;
    fetch(`/api/clients/${clientId}/deletion`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (gone) return;
        if (!res.ok) setLoadError(data.error ?? "Couldn't check what would be deleted. Check your connection and try again.");
        else setPreview(data);
      })
      .catch(() => !gone && setLoadError("Couldn't check what would be deleted. Check your connection and try again."));
    return () => {
      gone = true;
      stop.current = true;
    };
  }, [clientId]);

  const saveable = preview?.videos.filter((v) => v.saveable) ?? [];
  const gone = (preview?.videos.length ?? 0) - saveable.length;
  const needsKey = !teamKey && saveable.some((v) => v.encrypted);

  async function saveAll() {
    stop.current = false;
    setSaving({ done: 0, failed: [], finished: false });
    const failed: string[] = [];
    for (const [i, v] of saveable.entries()) {
      if (stop.current) return;
      try {
        await save(v, teamKey, business, name);
      } catch {
        failed.push(v.title ?? `Recording of ${madeOn(v.createdAt)}`);
      }
      setSaving({ done: i + 1, failed: [...failed], finished: false });
      // A moment between files, so the browser takes each one.
      await new Promise((r) => setTimeout(r, 400));
    }
    setSaving({ done: saveable.length, failed, finished: true });
  }

  async function remove() {
    setDeleting(true);
    setError(undefined);
    const res = await fetch(`/api/clients/${clientId}`, { method: "DELETE" }).catch(() => null);
    const data = (await res?.json().catch(() => null)) ?? {};
    setDeleting(false);
    if (!res?.ok) return setError(data.error ?? `Couldn't delete ${name}. Check your connection and try again.`);
    onDeleted({ emailed: !!preview?.willEmail });
  }

  const busy = deleting || savingNow;
  const videos = preview?.videos.length ?? 0;
  return (
    <DialogShell title={`Delete ${name} permanently?`} onClose={busy ? undefined : onClose} role="alertdialog" testId="remove-client-confirm">
      {!preview && !loadError && <p className="mt-3 text-sm text-dim">Checking what would be deleted…</p>}
      {loadError && (
        <p role="alert" className="mt-3 rounded-xl border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg">
          {loadError}
        </p>
      )}
      {preview && (
        <div className="mt-3 space-y-3 text-sm text-muted">
          <p className="font-medium text-ink">This can&apos;t be undone. Everything for {name} is erased from SureFrame straight away:</p>
          <ul className="list-disc space-y-1 pl-5" data-testid="remove-client-erases">
            <li>every conversation with them, with all replies and reactions{preview.replies ? ` (${plural(preview.replies, "reply", "replies")})` : ""}</li>
            <li>their to-dos, notes and reminders{preview.items ? ` (${plural(preview.items, "item", "items")})` : ""}</li>
            <li>their personal link, which stops working on every device</li>
            <li>{videos ? `${plural(videos, "video", "videos")} sent only to them` : "no videos: none were sent only to them"}</li>
          </ul>
          {preview.kept > 0 && (
            <p data-testid="remove-client-kept">
              {plural(preview.kept, "video", "videos")} you also sent to other clients or kept for your team {preview.kept === 1 ? "stays" : "stay"}, without {name} on {preview.kept === 1 ? "it" : "them"}.
            </p>
          )}
          <p>You can add {name} again later. They&apos;ll start as a new client, with a new personal link, and none of the above comes back.</p>
          {preview.willEmail && <p data-testid="remove-client-email-note">We&apos;ll email {name} that their access has ended.</p>}

          {videos > 0 && (
            <div className="rounded-xl border border-line bg-surface-2 p-3" data-testid="remove-client-save">
              <p className="font-medium text-ink">Save their videos first</p>
              <p className="mt-1">
                {saveable.length
                  ? `Save the ${plural(saveable.length, "video", "videos")} sent only to ${name} to this device before deleting. Your browser may ask to allow several downloads.`
                  : `The ${plural(videos, "video", "videos")} sent only to ${name} ${videos === 1 ? "has" : "have"} already left our servers, so there's nothing to save.`}
                {saveable.length > 0 && gone > 0 && ` ${plural(gone, "other has", "others have")} already left our servers and can't be saved.`}
              </p>
              {saveable.length > 0 && (
                <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto text-xs text-dim">
                  {saveable.map((v) => (
                    <li key={v.id} className="break-words">
                      {v.title ?? "Untitled"} · {madeOn(v.createdAt)}
                    </li>
                  ))}
                </ul>
              )}
              {saveable.length > 0 &&
                (needsKey ? (
                  <p className="mt-2 text-warn-fg" data-testid="remove-client-save-locked">
                    This browser doesn&apos;t have your team&apos;s key, so their videos can&apos;t be opened to save them. Close this, unlock with your key at the top of the page, then try again.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={saveAll} disabled={busy} className={secondaryButton} data-testid="remove-client-save-all">
                      {savingNow ? `Saving ${saving.done + 1} of ${saveable.length}…` : saving?.finished ? "Save them again" : `Download all ${plural(saveable.length, "video", "videos")}`}
                    </button>
                  </div>
                ))}
              {saving?.finished && (
                <p role="status" className={`mt-2 ${saving.failed.length ? "text-warn-fg" : "text-ok-fg"}`} data-testid="remove-client-saved">
                  {saving.failed.length
                    ? `${plural(saving.done - saving.failed.length, "video", "videos")} saved. Couldn't save: ${saving.failed.join(", ")}. Try again, or open it from your Library.`
                    : `Saved ${plural(saving.done, "video", "videos")} to this device. Check your downloads before deleting.`}
                </p>
              )}
            </div>
          )}

          <label className="flex items-start gap-2 text-ink">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5" data-testid="remove-client-sure" />
            <span>I understand {name} and everything above is deleted permanently and can&apos;t be restored.</span>
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg">
          {error}
        </p>
      )}
      <DialogButtons>
        {preview && (
          <button onClick={remove} disabled={!sure || busy} className={dangerButton} data-testid="remove-client-yes">
            {deleting ? "Deleting…" : `Delete ${name} permanently`}
          </button>
        )}
        <button onClick={onClose} disabled={busy} className={quietButton}>
          Cancel
        </button>
      </DialogButtons>
    </DialogShell>
  );
}
