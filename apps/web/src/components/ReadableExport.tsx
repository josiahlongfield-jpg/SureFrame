"use client";

import { useState } from "react";
import { decryptText, unwrapKey } from "@/lib/e2e/crypto";
import { loadKey, teamKeyName } from "@/lib/e2e/keystore";
import { readableHtml } from "@/lib/readableExport";

type Wrapped = { teamKeyWrap?: string | null };
type Item = { body: string; shared: boolean; clientId: string | null; text?: string | null };
type Reply = { body: string | null; encrypted: boolean; text?: string | null };
type Video = Wrapped & { message?: string | null; messageText?: string | null; replies: Reply[]; insight: { transcript: string; summary: string | null } | null };
type Team = { workspace: { id: string; name: string }; clients?: (Wrapped & { id: string })[]; videos?: Video[]; items?: Item[]; readable?: string };
type Export = { note: string; workspaces: Team[] };

const open = (sealed: string, key: CryptoKey | null | undefined) => (key ? decryptText(sealed, key).catch(() => null) : Promise.resolve(null));
const parsed = (text: string | null) => {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

/**
 * The data download with to-dos, notes, replies and AI transcripts and
 * summaries readable: the encrypted file is fetched, opened here with the
 * team key this browser holds, and saved. Nothing readable is sent anywhere.
 */
export async function readableCopy(data: Export) {
  for (const team of data.workspaces) {
    const teamKey = await loadKey(teamKeyName(team.workspace.id));
    if (!teamKey || !team.items) {
      team.readable = teamKey ? "Nothing encrypted to open." : "This browser doesn't hold this team's key, so its encrypted content is left as it was. Download again from a browser where its videos open.";
      continue;
    }
    const clientKeys = new Map<string, CryptoKey | null>();
    for (const c of team.clients ?? []) {
      clientKeys.set(c.id, c.teamKeyWrap ? await unwrapKey(c.teamKeyWrap, teamKey).catch(() => null) : null);
      delete c.teamKeyWrap;
    }
    let unopened = 0;
    for (const item of team.items) {
      // Shared to-dos and notes are sealed with the client's key; the team's own with the team key.
      const key = item.shared && item.clientId ? clientKeys.get(item.clientId) : teamKey;
      item.text = await open(item.body, key);
      if (item.text === null) unopened++;
      else item.body = "(decrypted: see text)";
    }
    for (const v of team.videos ?? []) {
      const videoKey = v.teamKeyWrap ? await unwrapKey(v.teamKeyWrap, teamKey).catch(() => null) : null;
      delete v.teamKeyWrap;
      // The message to the client shown above the video, sealed with the video's key.
      if (v.message) {
        v.messageText = await open(v.message, videoKey);
        if (v.messageText === null) unopened++;
        else v.message = "(decrypted: see messageText)";
      }
      for (const r of v.replies) {
        if (!r.encrypted || !r.body) continue;
        r.text = await open(r.body, videoKey);
        if (r.text === null) unopened++;
        else r.body = "(decrypted: see text)";
      }
      if (v.insight) {
        const transcript = parsed(await open(v.insight.transcript, videoKey));
        const summary = v.insight.summary ? parsed(await open(v.insight.summary, videoKey)) : null;
        if (transcript === null) unopened++;
        else Object.assign(v.insight, { transcript, summary });
      }
    }
    team.readable = unopened ? `Opened with this browser's key. ${unopened} encrypted ${unopened === 1 ? "entry" : "entries"} couldn't be opened and are left as they were.` : "Opened with this browser's key.";
  }
  data.note = "A readable copy: to-dos, notes, messages to clients, text replies and AI transcripts and summaries were decrypted in your browser with your team key before saving. Keep this file private. Download videos from each video's page.";
  return data;
}

/**
 * The readable copy, as a web page that opens in any browser (the default) or
 * as JSON for moving the data elsewhere. Both are made here from the
 * decrypted export.
 */
export default function ReadableExport() {
  const [busy, setBusy] = useState<"html" | "json" | null>(null);
  const [error, setError] = useState<string>();
  async function go(as: "html" | "json") {
    setBusy(as);
    setError(undefined);
    try {
      const res = await fetch("/api/account/export?wraps=1");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't download your data. Try again.");
      const data = await readableCopy((await res.json()) as Export);
      const blob =
        as === "html"
          ? new Blob([readableHtml(data as unknown as Record<string, unknown>)], { type: "text/html" })
          : new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `sureframe-export-readable-${new Date().toISOString().slice(0, 10)}.${as}` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <button type="button" onClick={() => go("html")} disabled={!!busy} data-testid="readable-export" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60">
        {busy === "html" ? "Preparing…" : "Download a readable copy"}
      </button>
      <button type="button" onClick={() => go("json")} disabled={!!busy} data-testid="readable-export-json" className="rounded-xl border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-hover disabled:opacity-60">
        {busy === "json" ? "Preparing…" : "Readable copy as JSON"}
      </button>
      {error && <p role="alert" className="mt-2 w-full text-sm text-danger-fg">{error}</p>}
    </>
  );
}
