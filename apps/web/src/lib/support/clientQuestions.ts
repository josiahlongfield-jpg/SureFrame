import { db } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { CLIENT_QUESTION_KEEP_DAYS } from "@/lib/periods";
import { supportInbox } from "@/lib/support/tickets";

export type ClientQuestionOutcome = "ANSWERED" | "CANT_HELP" | "FAILED" | "OFF";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
// The daily job doesn't run at exactly the same minute each day; the slack keeps the digest from slipping a day each week.
const DUE_AFTER_MS = WEEK_MS - 6 * 3_600_000;

/** One question as the client typed it, with only the business it was asked about (never who asked or the answer). */
export function recordClientQuestion(workspaceId: string, question: string, outcome: ClientQuestionOutcome, page: string) {
  return db.clientQuestion.create({ data: { workspaceId, question: question.slice(0, 500), outcome, page } }).catch((err) => {
    console.error("[client-help] couldn't record the question", String(err));
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** The same question asked slightly differently ("How do I reply?" and "how do i reply") counts once. */
const normal = (q: string) => q.toLowerCase().replace(/\s+/g, " ").replace(/[?.!\s]+$/, "").trim();

const NOT_ANSWERED: Record<Exclude<ClientQuestionOutcome, "ANSWERED">, string> = {
  CANT_HELP: "couldn't answer",
  FAILED: "AI error",
  OFF: "assistant off or over its daily cap",
};

/**
 * Once a week (checked by the daily purge job): the support inbox gets the client help questions asked since the
 * last digest, the ones the chat couldn't answer first, grouped and counted with the business's name, then the
 * most asked. Questions are kept as typed (lib/support/clientHelp.ts), so a bug clients keep hitting shows up here.
 */
export async function sendClientQuestionDigest(now = new Date()) {
  const to = supportInbox();
  if (!to) return "no-inbox";
  const last = await db.clientQuestionDigest.findFirst({ orderBy: { sentAt: "desc" } });
  if (last && now.getTime() - last.sentAt.getTime() < DUE_AFTER_MS) return "not-due";
  const since = last?.sentAt ?? new Date(now.getTime() - WEEK_MS);
  const rows = await db.clientQuestion.findMany({
    where: { createdAt: { gte: since, lt: now } },
    select: { question: true, outcome: true, workspace: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take: 20_000,
  });

  if (rows.length) {
    const groups = new Map<string, { question: string; outcome: string; business: string; count: number }>();
    const asked = new Map<string, { question: string; count: number; businesses: Set<string> }>();
    for (const r of rows) {
      const n = normal(r.question);
      if (r.outcome !== "ANSWERED") {
        const key = `${r.outcome}\u0000${r.workspace.name}\u0000${n}`;
        const g = groups.get(key) ?? { question: r.question, outcome: r.outcome, business: r.workspace.name, count: 0 };
        g.count++;
        groups.set(key, g);
      }
      const a = asked.get(n) ?? { question: r.question, count: 0, businesses: new Set<string>() };
      a.count++;
      a.businesses.add(r.workspace.name);
      asked.set(n, a);
    }
    const unanswered = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 200);
    const top = [...asked.values()].sort((a, b) => b.count - a.count).slice(0, 15);
    const missed = unanswered.reduce((n, g) => n + g.count, 0);
    const quote = (q: string) => `"${q.replace(/\s+/g, " ").trim()}"`;
    const names = (b: Set<string>) => [...b].slice(0, 3).join(", ") + (b.size > 3 ? ` and ${b.size - 3} more` : "");
    const unansweredLines = unanswered.map((g) => `${g.count} × ${quote(g.question)} (${g.business}; ${NOT_ANSWERED[g.outcome as keyof typeof NOT_ANSWERED] ?? g.outcome})`);
    const topLines = top.map((a) => `${a.count} × ${quote(a.question)} (${names(a.businesses)})`);
    const intro = `${rows.length} question${rows.length === 1 ? "" : "s"} from clients in the help chat on client pages since ${since.toISOString().slice(0, 10)}; ${missed} it couldn't answer.`;
    const note = `Only the question text and the business are kept (never who asked), for ${CLIENT_QUESTION_KEEP_DAYS} days. The chat never hands clients to us: it points them to the business.`;
    await sendMail({
      to,
      subject: `Client help chat this week: ${missed} unanswered of ${rows.length}`,
      text: [intro, "", "Couldn't answer:", ...(unansweredLines.length ? unansweredLines : ["None."]), "", "Most asked:", ...topLines, "", note].join("\n"),
      html: `<div style="font-family:system-ui,sans-serif;max-width:640px;color:#0f172a">
<p style="margin:0 0 12px">${esc(intro)}</p>
<h3 style="margin:16px 0 8px;font-size:15px">Couldn't answer</h3>
${unansweredLines.length ? `<ul style="margin:0;padding-left:20px">${unansweredLines.map((l) => `<li style="margin:0 0 6px">${esc(l)}</li>`).join("")}</ul>` : "<p>None.</p>"}
<h3 style="margin:16px 0 8px;font-size:15px">Most asked</h3>
<ul style="margin:0;padding-left:20px">${topLines.map((l) => `<li style="margin:0 0 6px">${esc(l)}</li>`).join("")}</ul>
<p style="margin:16px 0 0;font-size:12px;color:#64748b">${esc(note)}</p>
</div>`,
    });
  }
  // Recorded after sending, so a failed send is tried again the next day; a quiet week still counts as a week.
  await db.clientQuestionDigest.create({ data: { sentAt: now, questions: rows.length } });
  return { questions: rows.length };
}

/** Questions older than CLIENT_QUESTION_KEEP_DAYS, and digest records older than a year. */
export async function pruneClientQuestions(now = new Date()) {
  const [questions] = await Promise.all([
    db.clientQuestion.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - CLIENT_QUESTION_KEEP_DAYS * DAY_MS) } } }),
    db.clientQuestionDigest.deleteMany({ where: { sentAt: { lt: new Date(now.getTime() - 365 * DAY_MS) } } }),
  ]);
  return questions.count;
}
