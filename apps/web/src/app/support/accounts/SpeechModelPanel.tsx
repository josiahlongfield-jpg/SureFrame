"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ModelStatus = { revision: string; bytes: number; files: number; installedAt: string } | null;
type PlanFile = { name: string; bytes: number | null; done: boolean };
type Plan = { revision: string; files: PlanFile[]; installedRevision: string | null };

const mb = (n: number) => `${Math.round(n / 1_000_000)} MB`;

async function step<T>(body: object): Promise<T> {
  // A dropped connection (e.g. the phone locking) is retried; errors from the server are not.
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch("/api/support/speech-model", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (err) {
      if (attempt < 2) continue;
      throw new Error(`Lost the connection (${(err as Error).message}). Press Install again to carry on.`);
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data as T;
    if (res.status >= 500 && res.status !== 502 && attempt < 2) continue;
    throw new Error(data.error ?? `Something went wrong (HTTP ${res.status}). Press Install again to carry on.`);
  }
}

/**
 * Founder-only: copies the on-device speech model (for AI transcripts) from
 * Hugging Face into our own storage, one file per request, then switches it on.
 */
export default function SpeechModelPanel({ status, canInstall }: { status: ModelStatus; canInstall: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [progress, setProgress] = useState<{ label: string; fraction: number } | null>(null);

  async function install() {
    setBusy(true);
    setNote(null);
    try {
      setProgress({ label: "Checking the latest version…", fraction: 0 });
      const plan = await step<Plan>({ step: "plan" });
      const total = plan.files.reduce((n, f) => n + (f.bytes ?? 0), 0) || 1;
      let copied = plan.files.filter((f) => f.done).reduce((n, f) => n + (f.bytes ?? 0), 0);
      const todo = plan.files.filter((f) => !f.done);
      for (const [i, f] of todo.entries()) {
        setProgress({ label: `Copying file ${i + 1} of ${todo.length}: ${f.name}${f.bytes ? ` (${mb(f.bytes)})` : ""}…`, fraction: copied / total });
        await step({ step: "file", revision: plan.revision, name: f.name });
        copied += f.bytes ?? 0;
      }
      setProgress({ label: "Switching it on…", fraction: 1 });
      const done = await step<{ revision: string; bytes: number }>({ step: "finish", revision: plan.revision });
      setNote({ ok: true, text: `Installed version ${done.revision.slice(0, 7)} (${mb(done.bytes)}). Transcripts can be made now.` });
      router.refresh();
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-6" data-testid="speech-model">
      <h2 className="font-semibold text-ink">AI speech model</h2>
      <p className="mt-1 text-sm text-muted">
        The model that makes transcripts on people&apos;s own devices. Install it once; it&apos;s copied into our storage so browsers never download it from anyone else.
        Pressing it again updates to the newest version (and finishes an install that was interrupted).
      </p>
      <p className="mt-3 text-sm text-ink" data-testid="speech-model-status">
        {status
          ? `Installed: version ${status.revision.slice(0, 7)}, ${status.files} files, ${mb(status.bytes)}, on ${new Date(status.installedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`
          : "Not installed. Transcripts can't be made until it is."}
      </p>
      {!canInstall && <p className="mt-2 text-sm text-warn-fg">Connect the storage bucket first (S3_BUCKET); the model is too big for the database.</p>}
      <button
        onClick={install}
        disabled={busy || !canInstall}
        className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60"
      >
        {busy ? "Installing…" : status ? "Update speech model" : "Install speech model"}
      </button>
      {progress && (
        <div role="status" className="mt-3 text-sm text-muted">
          <p>{progress.label} Keep this page open.</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(3, Math.round(progress.fraction * 100))}%` }} />
          </div>
        </div>
      )}
      {note && <p role={note.ok ? "status" : "alert"} className={`mt-3 text-sm ${note.ok ? "text-ok-fg" : "text-danger-fg"}`}>{note.text}</p>}
    </section>
  );
}
