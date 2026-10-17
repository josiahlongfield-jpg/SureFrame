"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { REACTIONS } from "@/lib/reactions";
import type { ReplyDTO } from "@/lib/replies";
import { fixDuration } from "./MediaPlayer";
import ReplyComposer, { deleteReply, sendHeldReply, type ReplyComposerHandle } from "./ReplyComposer";
import SecureMedia, { useDecryptedUrl } from "./SecureMedia";
import TeamKeyGate from "./TeamKeyGate";
import AiInsight, { type SealedInsight } from "./AiInsight";
import AiNotice from "./AiNotice";
import CantOpen from "./CantOpen";
import SureFramePromo from "./SureFramePromo";
import { markLinkSent } from "./ClientsManager";
import SendPanel from "./SendPanel";
import { recoverInterrupted } from "@/lib/recorder/uploader";
import { useVideoFrame } from "@/lib/videoFrame";
import { makeThumb } from "@/lib/thumb";
import { decryptText, encryptText, importKey, unwrapKey } from "@/lib/e2e/crypto";
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
  /** The business's name: who a client's conversation is with. */
  business: string;
  /** Members only: may delete this video (staff can be limited to their own recordings). */
  canDelete?: boolean;
  /** Free: a finished original uses one of the plan's videos in total, and deleting it doesn't give that back. */
  freeVideoLimit?: number | null;
  /** Members only: clients this video can be sent to. */
  clients: ClientOption[];
  sentToId: string | null;
  initialReplies: ReplyDTO[];
  /** The viewer's own video and voice replies that were uploaded but never sent (a closed browser, say). */
  initialHeld?: ReplyDTO[];
  sendMany?: SendMany;
  /** AI summaries add-on: the encrypted transcript/summary, whether this viewer may make one, and whether to tell a client AI is used. */
  ai?: { insight: SealedInsight; canMake: boolean; notice: boolean };
  /** Members only: the client's reactions on this conversation, with the moment in the video if there was one. */
  reactions?: { emoji: string; timestampMs: number | null }[];
  /** The reactions this viewer has left (tap again to take one back). */
  myReactions?: string[];
  /** The business's message to the client, sealed with the video's key. */
  message?: string | null;
  /** Clients of a Free business: the intro, once per device per business. */
  promo?: { workspaceId: string };
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
  if (missing) return <LostKey clientId={clientId} business={props.business} videoId={props.video.id} />;
  if (!rootKey) return <Locked text="Unlocking…" />;
  return <WatchBody {...props} canEdit={false} rootKey={rootKey} />;
}

/**
 * A client this browser recognises (it has opened one of their links) but without the key that unlocks
 * their videos: an email link opened on a new device, a link missing its #k= part, or a browser that
 * cleared its storage (Safari does after a week or so without a visit). Only the business can send the
 * personal link again, so this asks them to.
 */
function LostKey({ clientId, business, videoId }: { clientId: string; business: string; videoId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "asked" | "failed">("idle");
  async function ask() {
    setState("busy");
    const res = await fetch(`/api/clients/${clientId}/lost-key`, { method: "POST" }).catch(() => null);
    const body = res?.ok ? ((await res.json().catch(() => ({}))) as { asked?: boolean }) : null;
    setState(body?.asked ? "asked" : "failed");
  }
  return (
    <CantOpen
      title="This device needs your personal link"
      testId="lost-key"
      signInNext={`/v/${videoId}`}
      action={
        state === "asked" ? (
          <p className="rounded-xl bg-ok-bg p-3 text-sm text-ok-fg" role="status" data-testid="lost-key-asked">
            Done. We&rsquo;ve emailed {business} to ask them to send you your personal link again. They&rsquo;ll send it to you themselves. When it
            arrives, open it on this device and this video will unlock.
          </p>
        ) : (
          <>
            <button onClick={ask} disabled={state === "busy"} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
              {state === "busy" ? "Asking…" : "Ask for my link again"}
            </button>
            {state === "failed" && <p role="alert" className="mt-2 text-sm text-danger-fg">That didn&rsquo;t go through. Please contact {business} directly.</p>}
          </>
        )
      }
    >
      <p>
        Videos from {business} unlock with the personal link they gave you: the full link, including the part after <span className="whitespace-nowrap">#k=</span>. This
        device hasn&rsquo;t opened that link yet, or this browser has since cleared it.
      </p>
      <p>Open your personal link on this device once, and this video and future email links from {business} will open here.</p>
    </CantOpen>
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

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });

/** A file name from its parts: no characters a phone or computer would refuse. */
const fileName = (...parts: string[]) => parts.map((p) => p.replace(/[^\w\- ]+/g, "").trim()).filter(Boolean).join(" - ") || "recording";

function WatchBody({
  video,
  ownerName,
  business,
  canEdit,
  canDelete,
  freeVideoLimit,
  clients: initialClients,
  sentToId,
  initialReplies,
  initialHeld = [],
  sendMany,
  ai,
  reactions: clientReactions,
  myReactions = [],
  message: sealedMessage = null,
  promo,
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
  const recipient = clients.find((c) => c.id === sentToId);
  // Who the conversation is with: the business, for a client; the client, for the team (none until it's sent).
  const counterpart = canEdit ? recipient?.name ?? null : business;
  const unsent = canEdit && !sentToId;
  const [replies, setReplies] = useState(initialReplies);
  const [held, setHeld] = useState(initialHeld);
  const listBox = useRef<HTMLDivElement>(null);
  const listContent = useRef<HTMLUListElement>(null);
  const stick = useRef(true);
  const composer = useRef<ReplyComposerHandle>(null);
  const panel = useRef<HTMLElement>(null);
  const inline = useRef<HTMLDivElement>(null);
  const reactionsRow = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  // Phones and narrow windows: the conversation lives behind a reply card under the video and opens as a full-screen sheet.
  const wide = useWide();
  const [sheet, setSheet] = useState(false);
  const [recording, setRecording] = useState(false);
  // The same, for the Back button's handler, which can run before a re-render.
  const recordingNow = useRef(false);
  const onRecording = useCallback((busy: boolean) => {
    recordingNow.current = busy;
    setRecording(busy);
  }, []);
  const [askDiscard, setAskDiscard] = useState(false);
  // The floating Reply button only shows while the reply card and reactions are scrolled out of sight, so it never covers them.
  const [bubbleShown, setBubbleShown] = useState(false);
  const [ended, setEnded] = useState(false);
  // When this viewer last had the conversation on screen (remembered per device), for the new-reply dot.
  const seenKey = `sureframe:seen-at:${video.id}`;
  const [seenAt, setSeenAt] = useState(() => {
    try {
      return localStorage.getItem(seenKey) ?? "";
    } catch {
      return "";
    }
  });

  // On wide screens the conversation sits beside the video, tall enough to show a video reply, and stays in view.
  useLayoutEffect(() => {
    const aside = panel.current;
    if (!aside) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const fit = () => {
      if (!wide.matches || aside.dataset.expanded) return void (aside.style.height = "");
      // Fits the screen under the top bar (it stays in view as the page scrolls), and room for a video reply.
      aside.style.height = `${Math.max(480, Math.min(window.innerHeight - 120, 820))}px`;
    };
    fit();
    wide.addEventListener("change", fit);
    window.addEventListener("resize", fit);
    return () => {
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

  // The conversation opens at its newest message, and follows new ones (and replies that grow as they unlock)
  // unless the viewer has scrolled up to read.
  useEffect(() => {
    const box = listBox.current;
    const content = listContent.current;
    if (!box || !content) return;
    const toEnd = () => stick.current && (box.scrollTop = box.scrollHeight);
    const onScroll = () => (stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 48);
    toEnd();
    box.addEventListener("scroll", onScroll, { passive: true });
    const watch = new ResizeObserver(toEnd);
    watch.observe(content);
    return () => {
      box.removeEventListener("scroll", onScroll);
      watch.disconnect();
    };
  }, []);

  /** Closes the phone sheet. Mid-recording it asks first: keep recording, or discard it and close. */
  const closeSheet = useCallback(() => {
    if (recording) return setAskDiscard(true);
    setAskDiscard(false);
    if (history.state?.fcConversation) history.back(); // popstate below closes it
    else setSheet(false);
  }, [recording]);

  async function discardAndClose() {
    await composer.current?.discard();
    recordingNow.current = false;
    setAskDiscard(false);
    if (history.state?.fcConversation) history.back();
    else setSheet(false);
  }

  function openSheet() {
    setSheet(true);
    stick.current = true;
    // An entry in the browser history, so the phone's Back button closes the sheet rather than leaving the page.
    history.pushState({ ...history.state, fcConversation: true }, "");
  }

  /** Takes the viewer to the reply box: the sheet on a phone, the panel beside the video on a computer. */
  function openConversation() {
    if (!wide) return openSheet();
    panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    panel.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!sheet) return;
    const onPop = () => {
      if (recordingNow.current) {
        history.pushState({ ...history.state, fcConversation: true }, "");
        setAskDiscard(true);
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
  }, [sheet, recording, closeSheet]);
  useEffect(() => {
    if (!recording) setAskDiscard(false);
  }, [recording]);

  // Widening the window past the phone layout shows the conversation in place.
  useEffect(() => {
    if (wide && sheet && !recording) closeSheet();
  }, [wide, sheet, recording, closeSheet]);

  // The floating button appears only once the viewer has scrolled past the reply card (and the reactions are
  // out of sight too), so it never sits over the video, the title, the reactions or the card.
  useEffect(() => {
    if (wide) return setBubbleShown(false);
    // Read on every scroll (not an observer set up once), so it holds however late the card and reactions render.
    const check = () => {
      const below = (el: HTMLElement | null) => !!el && el.getBoundingClientRect().bottom < 0;
      const card = inline.current;
      setBubbleShown(below(card) && (!reactionsRow.current || below(reactionsRow.current)));
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [wide, unsent]);

  // Messages from the other side count as seen while the conversation is on screen; the viewer's own never count.
  const showing = wide || sheet;
  const latest = replies.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), "");
  useEffect(() => {
    if (!showing || !latest) return;
    setSeenAt(latest);
    try {
      localStorage.setItem(seenKey, latest);
    } catch {
      /* storage blocked: the dot just resets next visit */
    }
  }, [showing, latest, seenKey]);
  const unread = replies.filter((r) => !r.mine && r.createdAt > seenAt).length;

  const [burst, setBurst] = useState<{ id: number; emoji: string }[]>([]);
  const [mine, setMine] = useState<ReadonlySet<string>>(() => new Set(myReactions));
  // Reactions on their way to the server (a ref, so taps in the same instant see it too).
  const inFlight = useRef(new Set<string>());

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
  // Pressing "Watch now" on the intro starts the video, even if it's still unlocking then.
  const playWhenReady = useRef(false);
  useEffect(() => {
    const el = player.current;
    if (!el || !playable) return;
    const undo = fixDuration(el);
    el.src = playable;
    if (playWhenReady.current) void el.play().catch(() => {});
    return undo;
  }, [playable]);
  const watchNow = useCallback(() => {
    playWhenReady.current = true;
    if (player.current?.src) void player.current.play().catch(() => {});
  }, []);

  // A client opening the video counts as a view, whether or not they press play (the team never counts).
  useEffect(() => {
    if (canEdit) return;
    void fetch(`/api/videos/${video.id}/view`, { method: "POST" }).catch(() => {});
  }, [canEdit, video.id]);

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

  /** Adds a reaction, or takes it back on a second tap. One request at a time per reaction, so taps never double up. */
  async function react(emoji: string) {
    if (inFlight.current.has(emoji)) return;
    inFlight.current.add(emoji);
    const on = !mine.has(emoji);
    setMine((cur) => {
      const next = new Set(cur);
      if (on) next.add(emoji);
      else next.delete(emoji);
      return next;
    });
    if (on) {
      const id = Date.now() + Math.random();
      setBurst((b) => [...b, { id, emoji }]);
      setTimeout(() => setBurst((b) => b.filter((x) => x.id !== id)), 1200);
    }
    const res = await fetch(`/api/videos/${video.id}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji, timestampMs: momentMs() }),
    }).catch(() => null);
    const result = res?.ok ? ((await res.json().catch(() => null)) as { on?: boolean } | null) : null;
    // The server has the last word (another tab may have changed it).
    setMine((cur) => {
      const next = new Set(cur);
      if (result ? result.on : !on) next.add(emoji);
      else next.delete(emoji);
      return next;
    });
    inFlight.current.delete(emoji);
  }

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/videos/${video.id}/replies`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { replies: ReplyDTO[]; held: ReplyDTO[] };
    setReplies(data.replies);
    setHeld(data.held);
  }, [video.id]);

  // A reply recording interrupted by a crash or closed tab finishes uploading here, then waits for its
  // author to send or delete it (it's never sent by itself).
  useEffect(() => {
    recoverInterrupted((_id, s) => {
      if (s.replyTo === video.id) void refresh();
    }).catch(() => {});
  }, [video.id, refresh]);

  // Keep the conversation fresh while the page is open.
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      const res = await fetch(`/api/videos/${video.id}/replies`, { headers: { "x-sf-background": "1" } }).catch(() => null);
      if (!res?.ok) return;
      const { replies } = (await res.json()) as { replies: ReplyDTO[] };
      setReplies((cur) => (replies.length !== cur.length || replies.at(-1)?.id !== cur.at(-1)?.id ? replies : cur));
    }, 15_000);
    return () => clearInterval(t);
  }, [video.id]);

  function addReply(r: ReplyDTO) {
    stick.current = true;
    setReplies((cur) => (cur.some((x) => x.id === r.id) ? cur : [...cur, r]));
  }

  async function removeReply(r: ReplyDTO) {
    const what = r.kind === "TEXT" ? "message" : r.kind === "VIDEO" ? "video reply" : "voice reply";
    if (!confirm(`Delete this ${what}? It's removed for ${counterpart ?? "everyone"} too, and can't be undone.`)) return;
    if (!(await deleteReply(video.id, r.id))) return alert("Couldn't delete it. Check your connection and try again.");
    setReplies((cur) => cur.filter((x) => x.id !== r.id));
    setHeld((cur) => cur.filter((x) => x.id !== r.id));
  }

  async function sendHeld(r: ReplyDTO) {
    const { reply, error } = await sendHeldReply(video.id, r.id);
    if (!reply) return alert(error);
    setHeld((cur) => cur.filter((x) => x.id !== r.id));
    addReply(reply);
  }

  const [titleSaved, setTitleSaved] = useState(false);
  const titleBox = useRef<HTMLTextAreaElement>(null);
  // The title box grows with its text, so a long title wraps instead of being cut off.
  useLayoutEffect(() => {
    const el = titleBox.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    };
    fit();
    // Again whenever its width changes (the layout settling, fonts arriving, a phone turning).
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => el.clientWidth !== width && ((width = el.clientWidth), fit()));
    watch.observe(el);
    void document.fonts?.ready.then(fit);
    return () => watch.disconnect();
  }, [title]);
  const lastTitle = useRef(video.title);
  async function saveTitle() {
    const next = title.replace(/\s+/g, " ").trim();
    if (!next) return setTitle(lastTitle.current);
    if (next === lastTitle.current) return;
    const res = await fetch(`/api/videos/${video.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    }).catch(() => null);
    if (!res?.ok) return alert((await res?.json().catch(() => ({})))?.error ?? "Couldn't save the new title. Check your connection and try again.");
    lastTitle.current = next;
    setTitle(next);
    setTitleSaved(true);
    setTimeout(() => setTitleSaved(false), 2500);
  }

  async function remove() {
    const others = sendMany && !sendMany.sourceId && sendMany.copies.length ? " The copies sent to other clients are deleted too." : "";
    const counts = freeVideoLimit ? ` It still counts towards your ${freeVideoLimit} free videos.` : "";
    if (!confirm(`Delete this video?${others}${counts} This can't be undone.`)) return;
    const res = await fetch(`/api/videos/${video.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return alert((await res?.json().catch(() => ({})))?.error ?? "Couldn't delete the video. Check your connection and try again.");
    router.push("/library");
  }

  const showPlayer = video.status !== "RECORDING" && !expired && !playError && !unplayable;

  const seek = (ms: number | null) => {
    if (ms === null || !player.current) return;
    player.current.currentTime = ms / 1000;
    void player.current.play().catch(() => {});
  };

  // True to the server: a client's reply emails the team (unless they turned that off); the team's replies email nobody.
  const sentNote = !canEdit
    ? `${business} can see it now, and they're emailed that you replied (unless they've turned those emails off).`
    : recipient
      ? `${recipient.name} sees it next time they open this video.`
      : "Your team can see it here, and so will the client you send this video to.";
  const emptyNote = !canEdit
    ? `Only you and ${business} can see this conversation.`
    : recipient
      ? `Only ${recipient.name} and your team can see this conversation.`
      : "Not sent to a client yet. Anything you add here will be seen by the client you send this video to.";
  const isWebm = !video.mimeType.includes("mp4");

  return (
    <div className="grid gap-8 pb-24 lg:grid-cols-[1fr_21.25rem] lg:pb-0">
      {promo && !canEdit && <SureFramePromo workspaceId={promo.workspaceId} business={business} onWatch={watchNow} />}
      <style>{BURST_CSS}</style>
      <section className="min-w-0">
        {sealedMessage && !canEdit && <BusinessMessage sealed={sealedMessage} rootKey={rootKey} from={ownerName} />}
        <div style={showPlayer ? frame.style : undefined} className="relative mx-auto overflow-hidden rounded-2xl bg-black shadow-sm">
          {video.status === "RECORDING" ? (
            <div className="grid aspect-video place-items-center text-dim">This recording is still uploading. Refresh in a moment.</div>
          ) : expired ? (
            <div className="grid aspect-video place-items-center px-6 text-center text-dim">
              This recording has been deleted from SureFrame. Ask the sender if they kept a copy.
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
              onPlay={() => setEnded(false)}
              onEnded={() => setEnded(true)}
              onError={(e) => e.currentTarget.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED && setUnplayable(true)}
              className="absolute inset-0 h-full w-full bg-black object-contain"
            />
          )}
          <div className="pointer-events-none absolute bottom-16 right-6 flex flex-col items-center">
            {burst.map((b) => (
              // On a white disc, fully opaque until the very end, so the emoji keeps its colours over any video.
              <span key={b.id} data-testid="reaction-burst" className="sf-burst grid h-14 w-14 place-items-center rounded-full bg-white text-3xl shadow-lg">{b.emoji}</span>
            ))}
          </div>
        </div>

        {ended && !canEdit && (
          <div data-testid="end-prompt" className="mt-4 flex flex-col gap-3 rounded-2xl border border-primary-line bg-primary-soft p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink">Finished watching? Let {business} know what you think, with a message, a voice note or a video.</p>
            <button onClick={openConversation} className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">
              Reply to {business}
            </button>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            {canEdit ? (
              <>
                <div className="flex items-start gap-1">
                  <textarea
                    ref={titleBox}
                    value={title}
                    rows={1}
                    maxLength={200}
                    onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
                    onBlur={saveTitle}
                    aria-label="Video title"
                    className="min-w-0 flex-1 resize-none overflow-hidden rounded-lg border border-line bg-transparent px-2 py-1 text-2xl font-semibold leading-snug text-ink [overflow-wrap:break-word] hover:border-line-strong focus:border-primary focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => titleBox.current?.focus()}
                    aria-label="Edit title"
                    title="Edit title"
                    className="mt-1.5 shrink-0 rounded-lg p-1.5 text-dim hover:bg-hover hover:text-ink"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>
                  </button>
                </div>
                <p className="mt-1 px-1 text-xs text-dim">
                  {titleSaved ? <span className="font-medium text-ok-fg" role="status" data-testid="title-saved">Saved. </span> : null}
                  Titles aren&apos;t encrypted, so keep private details in the video or your message.
                </p>
              </>
            ) : (
              <h1 className="text-2xl font-semibold leading-snug text-ink [overflow-wrap:break-word]">{title}</h1>
            )}
            <p className="mt-1 px-1 text-sm text-dim" data-testid="video-meta">
              {ownerName} · {day(video.createdAt)}
              {/* Only the team sees how often the client opened it. */}
              {canEdit && ` · ${video.viewCount} ${video.viewCount === 1 ? "view" : "views"}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            {playable && (
              <a
                href={playable}
                download={`${fileName(business, title)}.${isWebm ? "webm" : "mp4"}`}
                title={isWebm ? "Saves as a .webm file. Some iPhones and iPads can't play these; a computer can." : undefined}
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
          <p className="mt-3 flex items-start gap-2 px-1 text-xs text-dim" data-testid="purge-note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-px shrink-0" aria-hidden><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            <span>
              End-to-end encrypted. This video will be deleted from SureFrame on {day(video.purgeAt)}. Save it to your device if you want to keep a copy.
              {isWebm && playable && " It saves as a .webm file, which some iPhones can't play; a computer can."}
            </span>
          </p>
        )}

        {canEdit && <MessageEditor videoId={video.id} rootKey={rootKey} sealed={sealedMessage} to={recipient?.name ?? null} />}

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

        {/* Reactions belong to a conversation with a client, so not on a video that hasn't been sent yet. */}
        {!unsent && (
          <div ref={reactionsRow} className="mt-4 flex flex-wrap gap-2" data-testid="reactions">
            {REACTIONS.map((e) => {
              const on = mine.has(e);
              return (
                <button
                  key={e}
                  onClick={() => react(e)}
                  aria-label={`React ${e}`}
                  aria-pressed={on}
                  title={on ? "Tap again to take it back" : undefined}
                  className={`rounded-full border px-3 py-1.5 text-lg transition ${on ? "border-primary bg-primary-soft ring-1 ring-primary" : "border-line bg-surface hover:bg-hover"}`}
                >
                  {e}
                </button>
              );
            })}
          </div>
        )}
        {canEdit && clientReactions && clientReactions.length > 0 && <ReactionSummary reactions={clientReactions} onSeek={seek} who={recipient?.name ?? "The client"} />}

        {/* Phones: the way into the conversation, in the page itself, right under the reactions. */}
        <div ref={inline} data-testid="chat-inline" className="mt-4 rounded-2xl border border-line bg-surface p-4 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">{counterpart ? `Conversation with ${counterpart}` : "Conversation"}</p>
              <p className="text-xs text-dim">
                {replies.length === 0 ? "No messages yet" : `${replies.length} ${replies.length === 1 ? "message" : "messages"}`}
                {unread > 0 && <span className="font-medium text-accent"> · {unread} new</span>}
              </p>
            </div>
            {unread > 0 && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" aria-hidden data-testid="inline-unread" />}
          </div>
          <button onClick={openSheet} data-testid="chat-open" className="mt-3 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover">
            {canEdit ? "Open conversation" : `Reply to ${business}`}
          </button>
        </div>

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
        {!canEdit && <HowThisWorks business={business} purgeAt={video.purgeAt} expired={expired} />}
      </section>

      {!sheet && bubbleShown && (
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
          Reply
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
                "hidden flex-col self-start rounded-2xl border border-line bg-surface lg:sticky lg:top-6 lg:flex"
        }
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-ink [overflow-wrap:anywhere]" data-testid="conversation-title">{counterpart ? `Conversation with ${counterpart}` : "Conversation"}</h2>
            <p className="text-xs text-dim">Reply with a video, a voice note or a message. End-to-end encrypted.</p>
            {sheet && askDiscard && (
              <div role="alert" className="mt-2 rounded-lg bg-warn-bg p-2 text-xs text-warn-fg" data-testid="discard-ask">
                <p className="font-medium">You&apos;re still recording. Discard this recording and close?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={() => setAskDiscard(false)} className="rounded-md border border-warn-line bg-surface px-2.5 py-1 font-medium text-ink hover:bg-hover">Keep recording</button>
                  <button onClick={discardAndClose} className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700">Discard and close</button>
                </div>
              </div>
            )}
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
        <div ref={listBox} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ul ref={listContent} className="space-y-4 text-sm">
            {replies.length === 0 && <li className="text-dim" data-testid="conversation-empty">{emptyNote}</li>}
            {replies.map((r) => (
              // Your own messages sit on the right, in colour; the other side's on the left.
              <li key={r.id} className={`flex flex-col ${r.mine ? "items-end" : "items-start"}`} data-mine={r.mine || undefined}>
                <div className="mb-1 flex items-center gap-2 text-xs text-dim">
                  <span className="font-medium text-ink">{r.mine ? "You" : r.authorName}</span>
                  <span>{new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                </div>
                {r.kind === "TEXT" ? (
                  <div className={`max-w-[90%] rounded-2xl px-3 py-2 ${r.mine ? "rounded-tr-sm bg-primary text-on-primary" : "rounded-tl-sm bg-surface-2 text-ink"}`}>
                    {r.timestampMs !== null && (
                      <button
                        onClick={() => seek(r.timestampMs)}
                        className={`mr-1.5 rounded px-1.5 text-xs font-medium ${r.mine ? "bg-white/20 text-white" : "bg-surface text-accent"}`}
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
                {r.mine && (
                  <button onClick={() => removeReply(r)} className="mt-1 text-xs text-dim underline-offset-2 hover:text-danger-fg hover:underline" data-testid="reply-delete">
                    Delete
                  </button>
                )}
              </li>
            ))}
            <li aria-hidden />
          </ul>
        </div>
        {held.map((r) => (
          <div key={r.id} data-testid="held-reply" className="border-t border-line bg-warn-bg px-4 py-3 text-sm text-warn-fg">
            <p className="font-medium">Send or delete your unfinished reply?</p>
            <p className="mt-0.5 text-xs">
              You recorded this {r.kind === "VIDEO" ? "video" : "voice"} reply but didn&apos;t send it. Nobody else has seen it.
            </p>
            <div className="mt-2">
              <ReplyMedia reply={r} conversationKey={rootKey} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={() => sendHeld(r)} className="rounded-lg bg-primary px-3 py-2 font-semibold text-on-primary hover:bg-primary-hover">Send it</button>
              <button onClick={() => removeReply(r)} className="rounded-lg border border-line-strong bg-surface px-3 py-2 font-medium text-danger-fg hover:bg-hover">Delete it</button>
            </div>
          </div>
        ))}
        <ReplyComposer
          ref={composer}
          videoId={video.id}
          conversationKey={rootKey}
          currentTimeMs={momentMs}
          onReplied={addReply}
          onBusyChange={onRecording}
          offscreen={!wide && !sheet}
          sentNote={sentNote}
        />
      </aside>
    </div>
  );
}

/** The burst for a reaction: rises, staying fully opaque until the very end (a fading red heart over a green video looks brown). */
const BURST_CSS = `
.sf-burst { animation: sf-burst 1.2s ease-out forwards; }
@keyframes sf-burst { 0% { transform: translateY(0) scale(.8); opacity: 1; } 20% { transform: translateY(-1rem) scale(1); } 85% { opacity: 1; } 100% { transform: translateY(-7.5rem); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .sf-burst { animation-duration: .6s; } }
`;

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
  return <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{text ?? "…"}</span>;
}

function ReplyMedia({ reply, conversationKey }: { reply: ReplyDTO; conversationKey: CryptoKey }) {
  const [key, setKey] = useState<CryptoKey | null>(null);
  const media = reply.media!;
  useEffect(() => {
    if (media.parentKeyWrap) unwrapKey(media.parentKeyWrap, conversationKey).then(setKey, () => setKey(null));
  }, [media.parentKeyWrap, conversationKey]);
  if (media.expired) {
    return <p className="rounded-lg bg-surface-2 px-3 py-3 text-xs text-dim">This reply has been deleted from SureFrame.</p>;
  }
  return <SecureMedia url={media.url} mediaKey={key} mimeType={media.mimeType} kind={reply.kind === "AUDIO" ? "AUDIO" : "VIDEO"} />;
}

/** The business's message to the client, above the video. Sealed with the video's key; unlocked here. */
function BusinessMessage({ sealed, rootKey, from }: { sealed: string; rootKey: CryptoKey; from: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    decryptText(sealed, rootKey).then(setText, () => setText(null));
  }, [sealed, rootKey]);
  if (!text) return null;
  return (
    <div data-testid="business-message" className="mb-4 rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs font-medium text-dim">Message from {from}</p>
      <p className="mt-1 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{text}</p>
    </div>
  );
}

const MESSAGE_MAX = 1000;

/** Team only: a short message to the client, shown above the video. Encrypted on this device with the video's key, like replies. */
function MessageEditor({ videoId, rootKey, sealed, to }: { videoId: string; rootKey: CryptoKey; sealed: string | null; to: string | null }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  useEffect(() => {
    if (!sealed) return;
    decryptText(sealed, rootKey).then((t) => {
      setSaved(t);
      setText(t);
    }, () => setSaved(null));
  }, [sealed, rootKey]);

  async function save(next: string) {
    setState("saving");
    const trimmed = next.trim();
    const res = await fetch(`/api/videos/${videoId}/message`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: trimmed ? await encryptText(trimmed, rootKey) : null }),
    }).catch(() => null);
    if (!res?.ok) return setState("failed");
    setSaved(trimmed || null);
    setText(trimmed);
    setState("saved");
    setOpen(false);
  }

  const who = to ?? "your client";
  return (
    <div className="mt-4 rounded-2xl border border-line bg-surface p-4" data-testid="message-editor">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Message to {who}</p>
          {!open && (
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted [overflow-wrap:anywhere]">
              {saved ?? `Add a short note, shown to ${who} above the video.`}
            </p>
          )}
        </div>
        {!open && (
          <button onClick={() => setOpen(true)} className="shrink-0 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover">
            {saved ? "Edit" : "Add message"}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MESSAGE_MAX))}
            rows={3}
            aria-label={`Message to ${who}`}
            placeholder="e.g. Here's this week's plan. Let me know if anything's unclear."
            className="w-full resize-y rounded-lg border border-line-strong px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={() => save(text)} disabled={state === "saving"} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
              {state === "saving" ? "Saving…" : "Save message"}
            </button>
            <button onClick={() => (setOpen(false), setText(saved ?? ""))} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-hover">Cancel</button>
            {saved && (
              <button onClick={() => save("")} disabled={state === "saving"} className="rounded-lg px-3 py-1.5 text-sm text-danger-fg hover:bg-hover">Remove</button>
            )}
            <span className="text-xs text-dim">{text.length}/{MESSAGE_MAX}</span>
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-dim">
        {state === "saved" && <span className="font-medium text-ok-fg" role="status" data-testid="message-saved">Saved. </span>}
        {state === "failed" && <span className="font-medium text-danger-fg" role="alert">Couldn&apos;t save. Check your connection and try again. </span>}
        End-to-end encrypted, like replies. Only this conversation sees it.
      </p>
    </div>
  );
}

/** For clients: plain answers to what clients ask, each one true to how SureFrame works. */
function HowThisWorks({ business, purgeAt, expired }: { business: string; purgeAt: string | null; expired: boolean }) {
  const qa: [string, string][] = [
    [
      "Who can see my replies?",
      `Only you and ${business}. Your conversation is private: if they sent this recording to other people too, each conversation is separate. Messages, voice notes and videos are encrypted on your device, so SureFrame can't read or watch them.`,
    ],
    ["Will they know I replied?", `Yes. ${business} sees your reply here, and they're emailed that you replied unless they've turned those emails off. The email doesn't include what you said.`],
    [
      "Can I take a reply back?",
      "Yes. Video and voice replies can be played back before you send them, and nothing sends by itself. After sending, tap Delete under any of your replies to remove it for both of you, recording included.",
    ],
    [
      "When is this video deleted?",
      expired
        ? "This video's recording has already been deleted from SureFrame. Written replies stay until the conversation is deleted."
        : purgeAt
          ? `This video will be deleted from SureFrame on ${day(purgeAt)}. Video and voice replies are kept for the same length of time, counted from when each was sent. Written replies stay until the conversation is deleted. Save anything you want to keep.`
          : `${business} keeps this video until they delete it. Your replies are deleted along with it.`,
    ],
    [
      "Watching on another device?",
      `Open the personal link ${business} gave you on that device once (the full link, including the part after #k=). After that, their videos and email links open there too. The address in your browser bar (ending in /v/…) doesn't unlock anything on its own.`,
    ],
    ["Can anyone see that I watched?", `${business} can see how many times you've opened this video. Other clients can't.`],
  ];
  return (
    <details className="mt-5 rounded-2xl border border-line bg-surface text-sm" data-testid="how-this-works">
      <summary className="cursor-pointer rounded-2xl px-5 py-4 font-semibold text-ink hover:bg-hover">How this works</summary>
      <dl className="space-y-3 border-t border-line px-5 py-4">
        {qa.map(([q, a]) => (
          <div key={q}>
            <dt className="font-medium text-ink">{q}</dt>
            <dd className="mt-0.5 text-muted">{a}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** For the team: how the client reacted, and the moments they reacted to (tap one to jump there). */
function ReactionSummary({ reactions, onSeek, who }: { reactions: { emoji: string; timestampMs: number | null }[]; onSeek: (ms: number) => void; who: string }) {
  const byEmoji = new Map<string, (number | null)[]>();
  for (const r of reactions) byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r.timestampMs]);
  return (
    <div data-testid="reaction-summary" className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
      <span>{who} reacted:</span>
      {[...byEmoji].map(([emoji, moments]) => {
        const at = [...new Set(moments.filter((m): m is number => m !== null).sort((a, b) => a - b))];
        return (
          <span key={emoji} className="inline-flex flex-wrap items-center gap-1.5">
            <span aria-hidden>{emoji}</span>
            {moments.length > 1 && <span>{moments.length}</span>}
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
