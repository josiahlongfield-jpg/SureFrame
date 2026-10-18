/**
 * The readable copy of a data download as one web page: account, then for
 * each business its clients, videos with their messages and replies, and
 * to-dos and notes, then help conversations. Made in the browser from the
 * export after components/ReadableExport.tsx has decrypted it, so nothing
 * readable leaves the device. Opens in any browser and prints cleanly.
 */

type Loose = Record<string, unknown>;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const list = (v: unknown): Loose[] => (Array.isArray(v) ? (v as Loose[]) : []);
const day = (v: unknown) => {
  if (!v) return "";
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};
const minutes = (ms: unknown) => {
  const s = Math.round(Number(ms) / 1000);
  return Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "";
};
const table = (head: string[], rows: string[][]) =>
  rows.length
    ? `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : `<p class="dim">None.</p>`;
/** Text that may still be sealed: decrypted text if there is some, else a plain note. */
const opened = (text: unknown, sealed: unknown) => (typeof text === "string" ? `<p class="pre">${esc(text)}</p>` : sealed ? `<p class="dim">(Encrypted: open the readable copy from a browser that holds your team's key.)</p>` : "");

function insight(v: Loose | null | undefined) {
  if (!v) return "";
  const summary = v.summary as { overview?: string; keyPoints?: string[]; actionItems?: string[] } | string | null;
  const transcript = v.transcript as { segments?: { text: string }[] } | string | null;
  let out = "";
  if (summary && typeof summary === "object") {
    out += `<p><b>AI summary:</b> ${esc(summary.overview)}</p>`;
    if (summary.keyPoints?.length) out += `<p><b>Key points</b></p><ul>${summary.keyPoints.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`;
    if (summary.actionItems?.length) out += `<p><b>Action items</b></p><ul>${summary.actionItems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>`;
  }
  if (transcript && typeof transcript === "object" && transcript.segments?.length) {
    out += `<details><summary>Transcript</summary><p class="pre">${esc(transcript.segments.map((s) => s.text.trim()).join(" "))}</p></details>`;
  }
  return out;
}

export function readableHtml(data: Loose) {
  const user = (data.user ?? {}) as Loose;
  const exportedAt = day(data.exportedAt) || day(new Date().toISOString());
  const teams = list(data.workspaces).map((t) => {
    const ws = (t.workspace ?? {}) as Loose;
    if (t.paused) return `<section><h2>${esc(ws.name)}</h2><p class="dim">This team has paused your access, so only its name is included.</p></section>`;
    const clients = list(t.clients);
    const names = new Map(clients.map((c) => [String(c.id), String(c.name)]));
    const clientName = (id: unknown) => (id ? (names.get(String(id)) ?? "A client") : "");
    const videos = list(t.videos).filter((v) => !v.replyToId);
    const items = list(t.items);
    const clientRows = clients.map((c) => [
      esc(c.name),
      esc(c.email ?? ""),
      esc(day(c.createdAt)),
      c.removedAt ? `Removed ${esc(day(c.removedAt))}` : c.remindersOff ? "Emails off" : "Active",
    ]);
    const videoBlocks = videos.map((v) => {
      const replies = list(v.replies)
        .map((r) => {
          const kind = r.kind === "TEXT" ? "" : r.kind === "AUDIO" ? " (voice reply: play it on the video's page)" : " (video reply: play it on the video's page)";
          const body = r.kind === "TEXT" ? opened(r.text, r.encrypted && r.body) || (typeof r.body === "string" && !r.encrypted ? `<p class="pre">${esc(r.body)}</p>` : "") : "";
          return `<li><b>${esc(r.authorName ?? "")}</b> <span class="dim">${esc(day(r.createdAt))}${esc(kind)}</span>${body}</li>`;
        })
        .join("");
      return `<article>
<h4>${esc(v.title || "Untitled video")}</h4>
<p class="dim">${esc(day(v.createdAt))}${v.durationMs ? ` · ${esc(minutes(v.durationMs))}` : ""}${v.clientId ? ` · Sent to ${esc(clientName(v.clientId))}` : ""}${v.status === "EXPIRED" ? " · Deleted from our servers" : v.purgeAt ? ` · Deleted from our servers ${esc(day(v.purgeAt))}` : ""}</p>
${v.message ? `<p><b>Message to the client:</b></p>${opened(v.messageText, v.message)}` : ""}
${insight(v.insight as Loose | null)}
${replies ? `<p><b>Conversation</b></p><ul>${replies}</ul>` : ""}
</article>`;
    });
    const itemRows = items.map((i) => [
      esc(i.kind === "NOTE" ? "Note" : i.done ? "To-do (done)" : "To-do"),
      typeof i.text === "string" ? `<span class="pre">${esc(i.text)}</span>` : `<span class="dim">(Encrypted)</span>`,
      esc(i.dueAt ? day(i.dueAt) : ""),
      esc(i.clientId ? `${clientName(i.clientId)}${i.shared ? " (shared with them)" : ""}` : "Your team"),
    ]);
    const notices = list(t.staffNotices).map((n) => [esc(day(n.createdAt)), esc(n.from), esc(n.to), `<span class="pre">${esc(n.message)}</span>`]);
    return `<section>
<h2>${esc(ws.name)}</h2>
<p class="dim">Your role: ${esc(String(t.role ?? "").toLowerCase())} · Plan: ${esc(String(ws.plan ?? "").toLowerCase())}${ws.timezone ? ` · Time zone: ${esc(ws.timezone)}` : ""}</p>
${t.readable ? `<p class="note">${esc(t.readable)}</p>` : ""}
<h3>Clients (${clients.length})</h3>
${table(["Name", "Email", "Added", "Status"], clientRows)}
<h3>Videos (${videos.length})</h3>
${videoBlocks.join("") || `<p class="dim">None.</p>`}
<h3>To-dos and notes (${items.length})</h3>
${table(["What", "Text", "Due", "For"], itemRows)}
${notices.length ? `<h3>Staff reminders</h3>${table(["Sent", "From", "To", "Message"], notices)}` : ""}
</section>`;
  });
  const help = list(data.supportConversations).map(
    (c) => `<article><p class="dim">${esc(day(c.createdAt))}</p><ul>${list(c.messages).map((m) => `<li><b>${esc(({ CUSTOMER: "You", ASSISTANT: "Assistant", STAFF: "SureFrame team" } as Record<string, string>)[String(m.author)] ?? m.author)}</b> <span class="dim">${esc(day(m.createdAt))}</span><p class="pre">${esc(m.body)}</p></li>`).join("")}</ul></article>`,
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your SureFrame data</title>
<style>
body{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f2747;background:#fbf8f5;margin:0;padding:24px 16px}
main{max-width:860px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px}h2{font-size:20px;margin:32px 0 4px;padding-top:16px;border-top:2px solid #ece4dc}h3{font-size:16px;margin:20px 0 8px}h4{font-size:15px;margin:0 0 2px}
table{width:100%;border-collapse:collapse;font-size:14px;margin:0 0 8px}th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid #ece4dc;overflow-wrap:anywhere}th{font-weight:600;background:#f3efea}
article{background:#fff;border:1px solid #ece4dc;border-radius:12px;padding:12px 14px;margin:0 0 10px}
ul{padding-left:20px}li{margin:0 0 8px}.dim{color:#57687e;font-size:13px;margin:0}.pre{white-space:pre-wrap;margin:4px 0}.note{background:#fff7e6;border-radius:8px;padding:8px 10px;font-size:14px}
@media print{body{background:#fff}article{break-inside:avoid}}
</style></head><body><main>
<h1>Your SureFrame data</h1>
<p class="dim">${esc(user.name ? `${user.name} · ` : "")}${esc(user.email)} · Downloaded ${esc(exportedAt)}</p>
<p class="note">${esc(data.note)} Video and voice files aren't in this file: save them from each video's page.</p>
${teams.join("\n")}
<h2>Help conversations (${help.length})</h2>
${help.join("") || `<p class="dim">None.</p>`}
</main></body></html>`;
}
