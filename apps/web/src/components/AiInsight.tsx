"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { decryptText, encryptText } from "@/lib/e2e/crypto";
import type { DeviceSupport, Progress, Summary, Transcript } from "@/lib/ai/transcribe";
import { MAX_TRANSCRIBE_MINUTES } from "@/lib/ai/limits";

export type SealedInsight = { transcript: string; summary: string | null } | null;

type Props = {
  videoId: string;
  /** The video's key: the transcript and summary are sealed with it, like replies. */
  rootKey: CryptoKey;
  initial: SealedInsight;
  /**
   * Team member in a workspace with the add-on on, and the upload has fully
   * finished: may make transcripts (clients never do).
   */
  canMake: boolean;
  /** The decrypted recording on this device, once it's ready. */
  mediaUrl: string | null;
  durationMs: number | null;
  /** Team member: may remove the transcript and summary (even with the add-on off). */
  canRemove: boolean;
  onSeek: (ms: number) => void;
};

type Status =
  | { kind: "idle" }
  | { kind: "working"; progress: Progress }
  | { kind: "summarising" }
  | { kind: "failed"; message: string; device: boolean; model?: boolean; download?: boolean }
  | { kind: "summaryFailed"; message: string };

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Reads as flowing text: a new paragraph after a pause or a long stretch of speech. */
function paragraphs<T extends { start: number; end: number; text: string }>(segments: T[]): T[][] {
  const out: T[][] = [];
  let words = 0;
  for (const seg of segments) {
    const last = out.at(-1);
    const prev = last?.at(-1);
    if (!last || !prev || seg.start - prev.end > 2.5 || (words > 90 && /[.?!]$/.test(prev.text))) {
      out.push([seg]);
      words = 0;
    } else last.push(seg);
    words += seg.text.split(/\s+/).length;
  }
  return out;
}

/** Sends why a transcript failed (never any transcript text) to the server logs. */
function logFailure(message: string) {
  const body = JSON.stringify({ where: "ai-transcript", message: message.slice(0, 500), browser: navigator.userAgent });
  void fetch("/api/support/client-error", { method: "POST", body, keepalive: true }).catch(() => {});
}

/**
 * The AI summary and transcript under a video. The team makes them on their
 * own device (transcript) plus Claude (summary from the transcript text);
 * everyone who can watch the video reads them, decrypted here.
 */
export default function AiInsight({ videoId, rootKey, initial, canMake, mediaUrl, canRemove, onSeek, durationMs }: Props) {
  // Too long to transcribe on a device: say so up front rather than after decoding the audio.
  const tooLong = (durationMs ?? 0) > MAX_TRANSCRIBE_MINUTES * 60_000;
  const [sealed, setSealed] = useState<SealedInsight>(initial);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [support, setSupport] = useState<DeviceSupport | null>(null);
  // Collapsed to one labelled bar until the viewer opens it, so it doesn't push the page down.
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  // Unlock what's saved.
  useEffect(() => {
    if (!sealed) return;
    (async () => {
      setTranscript(JSON.parse(await decryptText(sealed.transcript, rootKey)) as Transcript);
      setSummary(sealed.summary ? (JSON.parse(await decryptText(sealed.summary, rootKey)) as Summary) : null);
    })().catch(() => setUnreadable(true));
  }, [sealed, rootKey]);

  // The model code only loads for workspaces with the add-on, and only when needed.
  useEffect(() => {
    if (!canMake) return;
    import("@/lib/ai/transcribe").then((m) => setSupport(m.deviceSupport()));
  }, [canMake]);

  const save = useCallback(
    async (t: Transcript, s: Summary | null) => {
      const body = { transcript: await encryptText(JSON.stringify(t), rootKey), summary: s ? await encryptText(JSON.stringify(s), rootKey) : null };
      const res = await fetch(`/api/videos/${videoId}/insight`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't save the transcript");
      setSealed(body);
    },
    [rootKey, videoId],
  );

  const summarise = useCallback(
    async (t: Transcript) => {
      setStatus({ kind: "summarising" });
      try {
        const { transcriptText } = await import("@/lib/ai/transcribe");
        const res = await fetch(`/api/videos/${videoId}/summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: transcriptText(t) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          await save(t, null);
          setStatus({ kind: "summaryFailed", message: data.error ?? "Couldn't write the summary just now." });
          return;
        }
        await save(t, data.summary as Summary);
        setSummary(data.summary as Summary);
        setStatus({ kind: "idle" });
      } catch (err) {
        setStatus({ kind: "summaryFailed", message: (err as Error).message });
      }
    },
    [save, videoId],
  );

  const make = useCallback(async () => {
    if (!mediaUrl) return;
    setStatus({ kind: "working", progress: { stage: "audio", fraction: 0 } });
    try {
      const { transcribe, ModelDownloadFailed, ModelUnavailable, UnsupportedDevice } = await import("@/lib/ai/transcribe");
      let t: Transcript;
      try {
        const media = await (await fetch(mediaUrl)).blob();
        t = await transcribe(media, (progress) => setStatus({ kind: "working", progress }));
      } catch (err) {
        console.warn("Transcript unavailable:", (err as Error).message);
        setStatus({
          kind: "failed",
          message: (err as Error).message,
          device: err instanceof UnsupportedDevice,
          model: err instanceof ModelUnavailable,
          download: err instanceof ModelDownloadFailed,
        });
        logFailure((err as Error).message);
        return;
      }
      setTranscript(t);
      if (!t.segments.length) {
        await save(t, null);
        setStatus({ kind: "summaryFailed", message: "No speech was found in this recording, so there's nothing to summarise." });
        return;
      }
      await summarise(t);
    } catch (err) {
      setStatus({ kind: "failed", message: (err as Error).message, device: false });
    }
  }, [mediaUrl, save, summarise]);

  async function remove() {
    if (!confirm("Remove this video's transcript and summary? Your team and client won't see them any more.")) return;
    const res = await fetch(`/api/videos/${videoId}/insight`, { method: "DELETE" });
    if (!res.ok) return;
    setSealed(null);
    setTranscript(null);
    setSummary(null);
    setStatus({ kind: "idle" });
  }

  if (!sealed && !canMake) return null;

  const busy = status.kind === "working" || status.kind === "summarising";
  const hint = unreadable
    ? "Locked on this device"
    : status.kind === "working"
      ? "Making the transcript…"
      : status.kind === "summarising"
        ? "Writing the summary…"
        : status.kind === "failed"
          ? "Transcript unavailable"
          : summary
            ? "Summary ready"
            : transcript
              ? "Transcript ready"
              : sealed
                ? "Unlocking…"
                : "Make a transcript";
  return (
    <section className="mt-5 rounded-2xl border border-line bg-surface" data-testid="ai-insight" data-open={open || undefined} aria-busy={busy}>
      <h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          data-testid="ai-toggle"
          className={`flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${open ? "rounded-t-2xl" : "rounded-2xl"}`}
        >
          <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-accent">AI</span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">AI summary and transcript</span>
            <span className="block text-xs text-dim" data-testid="ai-hint">{hint}</span>
          </span>
          <span className="hidden text-xs font-medium text-accent sm:inline">{open ? "Hide" : "Show"}</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className={`shrink-0 text-dim transition-transform ${open ? "rotate-180" : ""}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </h2>
      {/* Stays mounted while collapsed, so a transcript in progress keeps going. */}
      <div id={bodyId} hidden={!open} className="border-t border-line px-5 pb-5 pt-2">

        {unreadable && <p className="mt-2 text-sm text-muted">This summary was locked with a different key and can&apos;t be opened on this device.</p>}

        {status.kind === "working" && <Working progress={status.progress} />}
        {status.kind === "summarising" && <p role="status" className="mt-2 text-sm text-muted">Transcript done. Writing the summary…</p>}

        {status.kind === "failed" && (
          <div role="alert" className="mt-2 rounded-xl bg-warn-bg p-3 text-sm text-warn-fg" data-testid="ai-failed">
            <p className="font-medium">Transcript unavailable, try again.</p>
            <p className="mt-1 text-warn-fg">
              {/* Says whose problem it is: our server, the connection, or this device. Only the last blames the device. */}
              {status.model
                ? "Transcripts aren't available on SureFrame right now: the speech model on our server is missing or incomplete. It isn't a problem with your device. Please try again later."
                : status.download
                ? "The speech model didn't download properly, which is usually the connection. Check you're online and try again."
                : status.device
                ? "This device couldn't make the transcript. A computer with Chrome or Edge and plenty of memory works best."
                : support?.mobile || support?.lowMemory
                ? "This device may not be able to make transcripts. A computer with Chrome or Edge and plenty of memory works best."
                : "Something went wrong making the transcript. Your video is safe and unchanged."}
            </p>
            {status.message && !status.model && <p className="mt-1 text-xs text-warn-fg">Details: {status.message}</p>}
            <button onClick={make} className="mt-2 rounded-lg border border-warn-line bg-surface px-3 py-1.5 font-medium hover:bg-hover">Try again</button>
          </div>
        )}

        {summary ? (
          <div className="mt-2 text-sm text-muted" data-testid="ai-summary">
            <p className="whitespace-pre-wrap">{summary.overview}</p>
            {summary.keyPoints.length > 0 && (
              <>
                <h3 className="mt-3 font-medium text-ink">Key points</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5">{summary.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </>
            )}
            {summary.actionItems.length > 0 && (
              <>
                <h3 className="mt-3 font-medium text-ink">Action items</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5">{summary.actionItems.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </>
            )}
            <p className="mt-3 text-xs text-dim">Written by AI from an automatic transcript. It can contain mistakes, so check anything important against the video.</p>
          </div>
        ) : (
          !busy &&
          status.kind !== "failed" &&
          !transcript &&
          canMake && (
            <div className="mt-2 text-sm text-muted">
              <p>Make a transcript on this device and a short AI summary of this video. The audio stays on this device; only the transcript text is sent to write the summary.</p>
              {(support?.mobile || support?.lowMemory) && <p className="mt-1 text-warn-fg">This device may struggle with this. It works best on a computer.</p>}
              {tooLong ? (
                <p className="mt-2 text-warn-fg" data-testid="ai-too-long">Transcripts are available for videos up to {MAX_TRANSCRIBE_MINUTES} minutes.</p>
              ) : support && !support.device ? (
                <p className="mt-2 text-warn-fg">This browser can&apos;t make transcripts. Try again on a computer with Chrome or Edge.</p>
              ) : (
                <button
                  onClick={make}
                  disabled={!mediaUrl || !support}
                  className="mt-3 rounded-lg bg-primary px-4 py-2 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
                >
                  Make transcript and summary
                </button>
              )}
            </div>
          )
        )}

        {status.kind === "summaryFailed" && (
          <div role="alert" className="mt-2 text-sm text-muted">
            <p>{status.message}</p>
            {transcript && transcript.segments.length > 0 && (
              <button onClick={() => summarise(transcript)} className="mt-2 rounded-lg border border-line-strong px-3 py-1.5 font-medium hover:bg-hover">Try the summary again</button>
            )}
          </div>
        )}
        {!summary && transcript && status.kind === "idle" && canMake && transcript.segments.length > 0 && (
          <button onClick={() => summarise(transcript)} className="mt-2 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium hover:bg-hover">Write the summary</button>
        )}

        {transcript && (
          <details className="mt-4 border-t border-line pt-3 text-sm" data-testid="ai-transcript">
            <summary className="cursor-pointer font-medium text-ink">Transcript</summary>
            {transcript.segments.length === 0 ? (
              <p className="mt-2 text-dim">No speech was found.</p>
            ) : (
              <div className="mt-2 max-h-96 space-y-3 overflow-y-auto pr-1 leading-relaxed text-muted">
                {paragraphs(transcript.segments).map((para, p) => (
                  <p key={p}>
                    {para.map((s, i) => (
                      <span key={i}>
                        {i > 0 && " "}
                        <span
                          role="button"
                          tabIndex={0}
                          title={`Play from ${fmt(s.start)}`}
                          onClick={() => onSeek(Math.round(s.start * 1000))}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSeek(Math.round(s.start * 1000)))}
                          className="cursor-pointer rounded hover:bg-hover focus-visible:bg-surface-2 focus-visible:outline-none"
                        >
                          {s.text}
                        </span>
                      </span>
                    ))}
                  </p>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-dim">Made automatically on the sender&apos;s device. Words, names and numbers can be misheard. Click any sentence to play the video from there.</p>
          </details>
        )}
        {canRemove && sealed && !busy && (
          <button onClick={remove} className="mt-3 text-xs text-dim underline hover:text-ink">Remove transcript and summary</button>
        )}
      </div>
    </section>
  );
}

function Working({ progress }: { progress: Progress }) {
  const label =
    progress.stage === "audio"
      ? "Getting the sound ready…"
      : progress.stage === "download"
        ? `Downloading the transcription model to this device${progress.bytes ? ` (${Math.round(progress.bytes / 1_000_000)} MB, first time only)` : ""}…`
        : "Making the transcript on this device…";
  return (
    <div role="status" className="mt-2 text-sm text-muted">
      <p>{label} You can keep watching while this runs.</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(3, Math.round(progress.fraction * 100))}%` }} />
      </div>
    </div>
  );
}
