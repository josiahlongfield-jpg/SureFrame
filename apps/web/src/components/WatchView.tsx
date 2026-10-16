"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { REACTIONS } from "@/lib/reactions";
import type { ReplyDTO } from "@/lib/replies";
import { fixDuration } from "./MediaPlayer";
import ReplyComposer from "./ReplyComposer";
import SecureMedia, { useDecryptedUrl } from "./SecureMedia";
import TeamKeyGate from "./TeamKeyGate";
import AiInsight, { type SealedInsight } from "./AiInsight";
import AiNotice from "./AiNotice";
import { markLinkSent } from "./ClientsManager";
import SendPanel from "./SendPanel";
import { recoverInterrupted } from "@/lib/recorder/uploader";
import { useVideoFrame } from "@/lib/videoFrame";
import { makeThumb } from "@/lib/thumb";
import { decryptText, importKey, unwrapKey } from "@/lib/e2e/crypto";
import { clientKeyName, loadClientKey, saveKey } from "@/lib/e2e/keystore";

type Video = {
  id: string;
  title: string;
  status: string;
  mimeType: string;
  rawUrl: string;
  durationMs: number | null;
  viewCount: number;
  createdAt: string;
  encrypted: boolean;
  teamKeyWrap: string | null;
  clientKeyWrap: string | null;
  purgeAt: string | null;
};

export type ClientOption = {
  id: string;
  name: string;
  link: string;
  teamKeyWrap: string | null;
  assignedToId?: string | null;
  /** The client has their personal link (they opened it, or the business copied it to send), so a plain Send emails them. */
  hasLink?: boolean;
  /** Has an email address and hasn't turned emails off. */
  emailable?: boolean;
  /** Has an email address but turned emails off. */
  emailsOff?: boolean;
  /** For a copy sent to another client: that client's own conversation. */
  copyId?: string;
  /** Removed by the business: deleted for good on `until` (null once due or before it's set) unless restored. */
  removed?: { until: string | null; keepsRecording: boolean; recordingFirst?: boolean };
  /** Paused because the business's plan covers fewer clients. */
  paused?: boolean;
  /** Link turned off by SureFrame support. */
  linkOff?: boolean;
};

/** Members only: what's needed to send this recording to several clients at once. */
export type SendMany = {
  meId: string;
  /** Set when this page is one client's copy of another video. */
  sourceId: string | null;
  staff: { id: string; name: string }[];
  /** Copies already sent to other clients. */
  copies: { id: string; clientId: string }[];
};

export type WatchViewer = { kind: "member"; workspaceId: string; fingerprint: string | null } | { kind: "client"; clientId: string };

type Props = {
  video: Video;
  viewer: WatchViewer;
  ownerName: string;
  /** Members only: may delete this video (staff can be limited to their own recordings). */
  canDelete?: boolean;
  /** Free: a finished original uses one of the plan's videos in total, and deleting it doesn't give that back. */
  freeVideoLimit?: number | null;
  /** Members only: clients this video can be sent to. */
  clients: ClientOption[];
  sentToId: string | null;
  initialReplies: ReplyDTO[];
  sendMany?: SendMany;
  /** AI summaries add-on: the encrypted transcript/summary, whether this viewer may make one, and whether to tell a client AI is used. */
  ai?: { insight: SealedInsight; canMake: boolean; notice: boolean };
  /** Members only: reactions left on this conversation, with the moment in the video if there was one. */
  reactions?: { emoji: string; timestampMs: number | null }[];
  /** Set when this video is one client's copy of another recording. */
  sourceId?: string | null;
  /** Members only: the library already has a still of this recording (lib/thumb.ts). */
  hasThumb?: boolean;
};

/**
 * Unlocks the conversation on this device before showing it. Team members
 * use the team key; a client uses the key that arrived in their personal
 * link's #fragment (saved on this device the first time they open it).
 */
export default function WatchView(props: Props) {
  if (props.viewer.kind === "member") {
    return (
      <TeamKeyGate workspaceId={props.viewer.workspaceId} fingerprint={props.viewer.fingerprint}>
        {(teamKey) => <MemberUnlock {...props} teamKey={teamKey} />}
      </TeamKeyGate>
    );
  }
  return <ClientUnlock {...props} clientId={props.viewer.clientId} />;
}

function MemberUnlock({ teamKey, ...props }: Props & { teamKey: CryptoKey }) {
  const [rootKey, setRootKey] = useState<CryptoKey | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!props.video.teamKeyWrap) return setFailed(true);
    unwrapKey(props.video.teamKeyWrap, teamKey).then(setRootKey, () => setFailed(true));
  }, [props.video.teamKeyWrap, teamKey]);
  if (failed) return <Locked text="This video was locked with a different key and can't be opened on this device." />;
  if (!rootKey) return <Locked text="Unlocking…" />;
  return <WatchBody {...props} canEdit rootKey={rootKey} teamKey={teamKey} />;
}

function ClientUnlock({ clientId, ...props }: Props & { clientId: string }) {
  const [rootKey, setRootKey] = useState<CryptoKey | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    (async () => {
      // Arriving from a personal link: keep the key on this device, then hide it from the address bar.
      const fromLink = new URLSearchParams(window.location.hash.slice(1)).get("k");
      if (fromLink) {
        try {
          await saveKey(clientKeyName(clientId), await importKey(fromLink));
        } catch {
          /* malformed link; fall through to the stored key */
        }
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      const clientKey = await loadClientKey(clientId);
      if (!clientKey || !props.video.clientKeyWrap) return setMissing(true);
      void markLinkOpened(clientId);
      setRootKey(await unwrapKey(props.video.clientKeyWrap, clientKey));
    })().catch(() => setMissing(true));
  }, [clientId, props.video.clientKeyWrap]);
  if (missing) return <LostKey clientId={clientId} />;
  if (!rootKey) return <Locked text="Unlocking…" />;
  return <WatchBody {...props} canEdit={false} rootKey={rootKey} />;
}

/**
 * A client this browser recognises but whose key is gone (Safari clears site
 * data after a week or so without a visit). Only the business can make the
 * personal link again, so this asks them to.
 */
function LostKey({ clientId }: { clientId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "asked" | "failed">("idle");
  async function ask() {
    setState("busy");
    const res = await fetch(`/api/clients/${clientId}/lost-key`, { method: "POST" }).catch(() => null);
    const body = res?.ok ? ((await res.json().catch(() => ({}))) as { asked?: boolean }) : null;
    setState(body?.asked ? "asked" : "failed");
  }
  return (
    <div className="rounded-2xl border border-line bg-surface p-10 text-center text-muted sm:p-16" data-testid="lost-key">
      <p>Open this video from the personal link you were sent to unlock it on this device.</p>
      <p className="mt-2 text-sm text-dim">Can&rsquo;t find the link, or this browser forgot it? We&rsquo;ll ask them to send it again.</p>
      {state === "asked" ? (
        <p className="mt-4 text-sm font-medium text-ok-fg" role="status">Done. They&rsquo;ve been asked to send your personal link again.</p>
      ) : (
        <button onClick={ask} disabled={state === "busy"} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
          {state === "busy" ? "Asking…" : "Ask for my link again"}
        </button>
      )}
      {state === "failed" && <p role="alert" className="mt-2 text-sm text-danger-fg">That didn&rsquo;t go through. Please contact them directly.</p>}
    </div>
  );
}

/** Lets the business know this client has their personal link working (see api/clients/[id]/opened). */
function markLinkOpened(clientId: string) {
  return fetch(`/api/clients/${clientId}/opened`, { method: "POST" }).catch(() => {});
}

function Locked({ text }: { text: string }) {
  return <p className="rounded-2xl border border-line bg-surface p-16 text-center text-muted">{text}</p>;
}

/** Statuses where the recording is fully uploaded and safe on the server. */
const UPLOAD_DONE = new Set(["UPLOADED", "PROCESSING", "READY"]);

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function WatchBody({
  video,
  ownerName,
  canEdit,
  canDelete,
  freeVideoLimit,
  clients: initialClients,
  sentToId,
  initialReplies,
  sendMany,
  ai,
  reactions: initialReactions,
  hasThumb = true,
  sourceId = null,
  rootKey,
  teamKey,
}: Props & { canEdit: boolean; rootKey: CryptoKey; teamKey?: CryptoKey }) {
  const router = useRouter();
  const player = useRef<HTMLVideoElement>(null);
  // The player takes the recording's own shape (a phone's portrait camera too), so there are no black bars.
  const frame = useVideoFrame("75vh");
  const frameRef = frame.ref;
  const playerRef = useCallback(
    (v: HTMLVideoElement | null) => {
      player.current = v;
      frameRef(v);
    },
    [frameRef],
  );
  const [title, setTitle] = useState(video.title);
  // Clients whose link was copied on this page count as having it straight away.
  const [linked, setLinked] = useState<ReadonlySet<string>>(new Set());
  const clients = useMemo(() => initialClients.map((c) => (linked.has(c.id) ? { ...c, hasLink: true } : c)), [initialClients, linked]);
  const linkCopied = useCallback((clientId: string) => {
    void markLinkSent(clientId);
    setLinked((cur) => new Set(cur).add(clientId));
  }, []);
  const [replies, setReplies] = useState(initialReplies);
  const [reactions, setReactions] = useState(initialReactions);
  const listEnd = useRef<HTMLLIElement>(null);
  const reactionsRow = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  // Phones and narrow windows: the conversation lives behind a chat bubble and opens as a full-screen sheet.
  const wide = useWide();
  const [sheet, setSheet] = useState(false);
  const [replying, setReplying] = useState(false);
  const [sheetNote, setSheetNote] = useState<string>();
  // How many replies this viewer has had on screen (remembered per device), for the bubble's new-reply dot.
  const seenKey = `sureframe:seen-replies:${video.id}`;
  const [seen, setSeen] = useState(() => {
    try {
      return Number(localStorage.getItem(seenKey)) || 0;
    } catch {
      return 0;
    }
  });

  // On wide screens the conversation panel ends level with the reactions row,
  // so a long transcript or summary below the video doesn't stretch it.
  useLayoutEffect(() => {
    const row = reactionsRow.current;
    const aside = panel.current;
    if (!row || !aside) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const fit = () => {
      if (!wide.matches || aside.dataset.expanded) return void (aside.style.height = "");
      const height = row.getBoundingClientRect().bottom - aside.getBoundingClientRect().top;
      aside.style.height = `${Math.max(420, Math.round(height))}px`;
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(row.parentElement ?? row);
    wide.addEventListener("change", fit);
    window.addEventListener("resize", fit);
    return () => {
      watch.disconnect();
      wide.removeEventListener("change", fit);
      window.removeEventListener("resize", fit);
    };
  }, [expanded]);

  // The larger view closes with Escape.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const onBusyChange = useCallback((busy: boolean) => {
    setReplying(busy);
    if (!busy) setSheetNote(undefined);
  }, []);

  /** Closes the phone sheet, unless a voice or video reply is still recording or sending. */
  const closeSheet = useCallback(() => {
    if (replying) return setSheetNote("Your reply is still recording or sending. Tap Stop and send, or wait until it's sent, before closing.");
    setSheetNote(undefined);
    if (history.state?.fcConversation) history.back(); // popstate below closes it
    else setSheet(false);
  }, [replying]);

  function openSheet() {
    setSheet(true);
    // An entry in the browser history, so the phone's Back button closes the sheet rather than leaving the page.
    history.pushState({ ...history.state, fcConversation: true }, "");
    requestAnimationFrame(() => listEnd.current?.scrollIntoView({ block: "nearest" }));
  }

  useEffect(() => {
    if (!sheet) return;
    const onPop = () => {
      if (replying) {
        history.pushState({ ...history.state, fcConversation: true }, "");
        setSheetNote("Your reply is still recording or sending. Tap Stop and send, or wait until it's sent, before closing.");
        return;
      }
      setSheet(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeSheet();
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    // The page behind doesn't scroll while the sheet is open.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [sheet, replying, closeSheet]);

  // Widening the window past the phone layout shows the conversation in place.
  useEffect(() => {
    if (wide && sheet && !replying) closeSheet();
  }, [wide, sheet, replying, closeSheet]);

  // Replies count as seen while the conversation is on screen.
  const showing = wide || sheet;
  useEffect(() => {
    if (!showing) return;
    setSeen(replies.length);
    try {
      localStorage.setItem(seenKey, String(replies.length));
    } catch {
      /* storage blocked: the dot just resets next visit */
    }
  }, [showing, replies.length, seenKey]);
  const unread = Math.max(0, replies.length - seen);

  const [burst, setBurst] = useState<{ id: number; emoji: string }[]>([]);
  const viewed = useRef(false);

  // Encrypted recordings are downloaded and decrypted here, on the viewer's device.
  const expired = video.status === "EXPIRED";
  const { src, error: playError } = useDecryptedUrl(
    video.status === "RECORDING" || expired ? null : video.rawUrl,
    video.encrypted ? rootKey : null,
    video.mimeType,
  );
  const playable = video.encrypted ? src : video.rawUrl;
  // The first time the team opens a recording, its library still is made here (the server can't see the video).
  const thumbTried = useRef(false);
  useEffect(() => {
    if (!canEdit || hasThumb || !video.encrypted || !src || thumbTried.current) return;
    thumbTried.current = true;
    void makeThumb(video.id, src, rootKey).catch(() => {});
  }, [canEdit, hasThumb, video.encrypted, video.id, src, rootKey]);
  // The recording downloaded fine but this device can't decode its format.
  const [unplayable, setUnplayable] = useState(false);
  useEffect(() => {
    const el = player.current;
    if (!el || !playable) return;
    const undo = fixDuration(el);
    el.src = playable;
    return undo;
  }, [playable]);

  /**
   * The playback position to pin a reply or reaction to, or undefined when the
   * viewer hasn't reached a real moment yet (including the temporary far-seek
   * used to work out a WebM file's length).
   */
  function momentMs() {
    const el = player.current;
    if (!el || !Number.isFinite(el.duration) || el.currentTime < 0.5 || el.currentTime > el.duration) return undefined;
    return Math.round(el.currentTime * 1000);
  }

  function onPlay() {
    if (viewed.current) return;
    viewed.current = true;
    void fetch(`/api/videos/${video.id}/view`, { method: "POST" });
  }

  async function react(emoji: string) {
    const id = Date.now() + Math.random();
    setBurst((b) => [...b, { id, emoji }]);
    setTimeout(() => setBurst((b) => b.filter((x) => x.id !== id)), 1200);
    const timestampMs = momentMs();
    const res = await fetch(`/api/videos/${video.id}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji, timestampMs }),
    }).catch(() => null);
    if (res?.ok) setReactions((r) => r && [...r, { emoji, timestampMs: timestampMs ?? null }]);
  }


  // Finish sending any reply that a crash or closed tab interrupted.
  useEffect(() => {
    recoverInterrupted(async (_id, s) => {
      if (s.replyTo !== video.id) return;
      const res = await fetch(`/api/videos/${video.id}/replies`);
      if (res.ok) setReplies((await res.json()).replies);
    }).catch(() => {});
  }, [video.id]);

  // Keep the conversation fresh while the page is open.
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      const res = await fetch(`/api/videos/${video.id}/replies`, { headers: { "x-sf-background": "1" } }).catch(() => null);
      if (!res?.ok) return;
      const { replies } = (await res.json()) as { replies: ReplyDTO[] };
      setReplies((cur) => (replies.length !== cur.length ? replies : cur));
    }, 15_000);
    return () => clearInterval(t);
  }, [video.id]);

  function addReply(r: ReplyDTO) {
    setReplies((cur) => (cur.some((x) => x.id === r.id) ? cur : [...cur, r]));
    requestAnimationFrame(() => listEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  async function saveTitle() {
    if (title.trim() && title !== video.title) {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }).catch(() => null);
      if (!res?.ok) alert((await res?.json().catch(() => ({})))?.error ?? "Couldn't save the new title. Check your connection and try again.");
    }
  }

  async function remove() {
    const others = sendMany && !sendMany.sourceId && sendMany.copies.length ? " The copies sent to other clients are deleted too." : "";
    const counts = freeVideoLimit ? ` It still counts towards your ${freeVideoLimit} free videos.` : "";
    if (!confirm(`Delete this video?${others}${counts} This can't be undone.`)) return;
    const res = await fetch(`/api/videos/${video.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return alert((await res?.json().catch(() => ({})))?.error ?? "Couldn't delete the video. Check your connection and try again.");
    router.push("/library");
  }

  const recipient = clients.find((c) => c.id === sentToId);

  const showPlayer = video.status !== "RECORDING" && !expired && !playError && !unplayable;

  const seek = (ms: number | null) => {
    if (ms === null || !player.current) return;
    player.current.currentTime = ms / 1000;
    void player.current.play().catch(() => {});
  };

  return (
    <div className="grid gap-8 pb-20 lg:grid-cols-[1fr_21.25rem] lg:pb-0">
      <section>
        <div style={showPlayer ? frame.style : undefined} className="relative mx-auto overflow-hidden rounded-2xl bg-black shadow-sm">
          {video.status === "RECORDING" ? (
            <div className="grid aspect-video place-items-center text-dim">This recording is still uploading. Refresh in a moment.</div>
          ) : expired ? (
            <div className="grid aspect-video place-items-center px-6 text-center text-dim">
              This recording has been deleted from our servers. Ask the sender if they kept a copy.
            </div>
          ) : playError ? (
            <div className="grid aspect-video place-items-center text-dim">Couldn&apos;t unlock this recording on this device.</div>
          ) : unplayable ? (
            <div data-testid="unplayable" className="grid aspect-video place-items-center px-6 text-center text-dim">
              This device can&apos;t play this recording&apos;s format. Try another browser or a computer, or ask the sender to record it again.
            </div>
          ) : (
            <video
              ref={playerRef}
              controls
              playsInline
              onPlay={onPlay}
              onError={(e) => e.currentTarget.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && setUnplayable(true)}
              className="absolute inset-0 h-full w-full bg-black object-contain"
            />
          )}
          <div className="pointer-events-none absolute bottom-16 right-6 flex flex-col items-center">
            {burst.map((b) => (
              <span key={b.id} className="animate-[float_1.2s_ease-out_forwards] text-4xl">{b.emoji}</span>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            {canEdit ? (
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                aria-label="Video title"
                className="w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-2xl font-semibold text-ink hover:border-line focus:border-primary focus:outline-none"
              />
            ) : (
              <h1 className="text-2xl font-semibold text-ink">{title}</h1>
            )}
            <p className="mt-1 px-1 text-sm text-dim">
              {ownerName} · {new Date(video.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })} · {video.viewCount} {video.viewCount === 1 ? "view" : "views"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            {playable && (
              <a
                href={playable}
                download={`${title.replace(/[^\w\- ]+/g, "").trim() || "recording"}.${video.mimeType.includes("mp4") ? "mp4" : "webm"}`}
                className="rounded-xl border border-line-strong px-4 py-2 text-sm text-muted hover:bg-hover"
              >
                Save to device
              </a>
            )}
            {canEdit && canDelete && (
              <button onClick={remove} className="rounded-xl border border-line-strong px-4 py-2 text-sm text-muted hover:bg-hover">Delete</button>
            )}
          </div>
        </div>

        {video.purgeAt && !expired && (
          <p className="mt-3 flex items-center gap-2 px-1 text-xs text-dim">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            End-to-end encrypted. Our encrypted copy is deleted on{" "}
            {new Date(video.purgeAt).toLocaleDateString("en-US", { dateStyle: "medium" })}. Save it to your device to keep it.
          </p>
        )}

        {canEdit && recipient?.removed && (
          <p data-testid="recipient-removed" className="mt-5 rounded-2xl border border-warn-line bg-warn-bg p-4 text-sm text-warn-fg">
            {recipient.name} was removed from your clients, so their link no longer opens this.
            {recipient.removed.until &&
              (recipient.removed.keepsRecording
                ? ` Their conversation here will be deleted on ${recipient.removed.until} unless ${recipient.name} is restored on the Clients page. The recording itself stays, as you also sent it to other clients.`
                : recipient.removed.recordingFirst || expired
                  ? ` This conversation will be deleted on ${recipient.removed.until} unless ${recipient.name} is restored on the Clients page.`
                  : ` This conversation and recording will be deleted on ${recipient.removed.until} unless ${recipient.name} is restored on the Clients page.`)}
          </p>
        )}
        {canEdit && teamKey && !expired && (
          <SendPanel
            video={{ id: video.id, title, status: video.status, encrypted: video.encrypted, sourceId }}
            clients={clients}
            sentToId={sentToId}
            sendMany={sendMany}
            hasReplies={replies.length > 0}
            rootKey={rootKey}
            teamKey={teamKey}
            onLinkCopied={linkCopied}
          />
        )}

        <div ref={reactionsRow} className="mt-4 flex flex-wrap gap-2">
          {REACTIONS.map((e) => (
            <button key={e} onClick={() => react(e)} aria-label={`React ${e}`} className="rounded-full border border-line bg-surface px-3 py-1.5 text-lg hover:bg-hover">
              {e}
            </button>
          ))}
        </div>
        {reactions && reactions.length > 0 && <ReactionSummary reactions={reactions} onSeek={seek} />}

        {ai && !expired && (
          <AiInsight
            videoId={video.id}
            rootKey={rootKey}
            initial={ai.insight}
            // Only once the upload has fully finished, so it never competes with the recording.
            canMake={ai.canMake && canEdit && UPLOAD_DONE.has(video.status)}
            mediaUrl={playable || null}
            durationMs={video.durationMs}
            canRemove={canEdit}
            onSeek={seek}
          />
        )}
        {ai?.notice && !canEdit && <AiNotice className="mt-4" />}
      </section>

      {!sheet && (
        <button
          type="button"
          onClick={openSheet}
          data-testid="chat-bubble"
          aria-label={`Open conversation (${replies.length} ${replies.length === 1 ? "reply" : "replies"}${unread ? `, ${unread} new` : ""})`}
          className="fixed bottom-5 left-5 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-on-primary shadow-lg hover:bg-primary-hover lg:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M4 5h16v11H9l-5 4V5z" />
            <path d="M8 9.5h8M8 12.5h5" />
          </svg>
          Chat
          {replies.length > 0 && <span className="rounded-full bg-white/25 px-1.5 text-xs">{replies.length}</span>}
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-red-500" data-testid="chat-unread" />}
        </button>
      )}
      {expanded && <div className="fixed inset-0 z-40 bg-solid/50" onClick={() => setExpanded(false)} aria-hidden />}
      <aside
        ref={panel}
        data-testid="conversation"
        data-expanded={expanded || undefined}
        data-sheet={sheet || undefined}
        role={expanded || sheet ? "dialog" : undefined}
        aria-modal={expanded || sheet || undefined}
        aria-label={expanded || sheet ? "Conversation" : undefined}
        className={
          sheet
            ? "fixed inset-0 z-[60] flex h-[100dvh] flex-col bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
            : expanded
              ? "fixed inset-x-4 inset-y-6 z-50 mx-auto flex max-w-3xl flex-col rounded-2xl border border-line bg-surface shadow-2xl"
              : // Kept mounted (just hidden) on phones, so a reply in progress is never lost.
                "hidden flex-col self-start rounded-2xl border border-line bg-surface lg:flex"
        }
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold text-ink">Conversation</h2>
            <p className="text-xs text-dim">Reply with a video, a voice note or a message. End-to-end encrypted.</p>
            {sheet && sheetNote && <p role="alert" className="mt-2 text-xs font-medium text-warn-fg">{sheetNote}</p>}
          </div>
          {sheet ? (
            <button
              type="button"
              onClick={closeSheet}
              aria-label="Close conversation"
              data-testid="chat-close"
              className="-mr-1 shrink-0 rounded-lg p-2 text-muted hover:bg-hover hover:text-ink"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          ) : (
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Close larger view" : "Open conversation in a larger view"}
            title={expanded ? "Close" : "Expand"}
            className="hidden shrink-0 rounded-lg p-1.5 text-dim hover:bg-hover hover:text-ink lg:block"
          >
            {expanded ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
            )}
          </button>
          )}
        </div>
        <ul className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {replies.length === 0 && <li className="text-dim">No replies yet. Be the first to respond.</li>}
          {replies.map((r) => (
            <li key={r.id} className={`flex flex-col ${r.fromOwner ? "items-start" : "items-end"}`}>
              <div className="mb-1 flex items-center gap-2 text-xs text-dim">
                <span className="font-medium text-ink">{r.authorName}</span>
                <span>{new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </div>
              {r.kind === "TEXT" ? (
                <div className={`max-w-[90%] rounded-2xl px-3 py-2 ${r.fromOwner ? "rounded-tl-sm bg-surface-2 text-ink" : "rounded-tr-sm bg-primary text-on-primary"}`}>
                  {r.timestampMs !== null && (
                    <button
                      onClick={() => seek(r.timestampMs)}
                      className={`mr-1.5 rounded px-1.5 text-xs font-medium ${r.fromOwner ? "bg-surface text-accent" : "bg-white/20 text-white"}`}
                    >
                      {fmt(r.timestampMs)}
                    </button>
                  )}
                  <ReplyText reply={r} conversationKey={rootKey} />
                </div>
              ) : r.media ? (
                <div className="w-full max-w-[90%]">
                  <ReplyMedia reply={r} conversationKey={rootKey} />
                </div>
              ) : null}
            </li>
          ))}
          <li ref={listEnd} aria-hidden />
        </ul>
        <ReplyComposer
          videoId={video.id}
          conversationKey={rootKey}
          currentTimeMs={momentMs}
          onReplied={addReply}
          onBusyChange={onBusyChange}
          offscreen={!wide && !sheet}
        />
      </aside>
    </div>
  );
}

/** True at the desktop layout (Tailwind's lg breakpoint), where the conversation sits beside the video. */
function useWide() {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

function ReplyText({ reply, conversationKey }: { reply: ReplyDTO; conversationKey: CryptoKey }) {
  const [text, setText] = useState<string | null>(reply.encrypted ? null : reply.body);
  useEffect(() => {
    if (!reply.encrypted || !reply.body) return;
    decryptText(reply.body, conversationKey).then(setText, () => setText("[Couldn't unlock this message]"));
  }, [reply.body, reply.encrypted, conversationKey]);
  return <span className="whitespace-pre-wrap">{text ?? "…"}</span>;
}

function ReplyMedia({ reply, conversationKey }: { reply: ReplyDTO; conversationKey: CryptoKey }) {
  const [key, setKey] = useState<CryptoKey | null>(null);
  const media = reply.media!;
  useEffect(() => {
    if (media.parentKeyWrap) unwrapKey(media.parentKeyWrap, conversationKey).then(setKey, () => setKey(null));
  }, [media.parentKeyWrap, conversationKey]);
  if (media.expired) {
    return <p className="rounded-lg bg-surface-2 px-3 py-3 text-xs text-dim">This reply has expired from our servers.</p>;
  }
  return <SecureMedia url={media.url} mediaKey={key} mimeType={media.mimeType} kind={reply.kind === "AUDIO" ? "AUDIO" : "VIDEO"} />;
}

/** For the team: how the client reacted, and the moments they reacted to (tap one to jump there). */
function ReactionSummary({ reactions, onSeek }: { reactions: { emoji: string; timestampMs: number | null }[]; onSeek: (ms: number) => void }) {
  const byEmoji = new Map<string, (number | null)[]>();
  for (const r of reactions) byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r.timestampMs]);
  return (
    <div data-testid="reaction-summary" className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
      <span>Reactions:</span>
      {[...byEmoji].map(([emoji, moments]) => {
        const at = [...new Set(moments.filter((m): m is number => m !== null).sort((a, b) => a - b))];
        return (
          <span key={emoji} className="inline-flex flex-wrap items-center gap-1.5">
            <span aria-hidden>{emoji}</span>
            <span>{moments.length}</span>
            {at.slice(0, 6).map((ms) => (
              <button key={ms} type="button" onClick={() => onSeek(ms)} className="rounded bg-surface-2 px-1.5 text-xs text-muted hover:bg-line-strong" aria-label={`Play from ${fmt(ms)}`}>
                {fmt(ms)}
              </button>
            ))}
            {at.length > 6 && <span className="text-xs text-dim">+{at.length - 6} more</span>}
          </span>
        );
      })}
    </div>
  );
}
