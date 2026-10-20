import { z } from "zod";
import { handle, HttpError } from "@/lib/session";
import { limitByIp, rateLimit } from "@/lib/rateLimit";
import { assistantEnabled } from "@/lib/support/assistant";
import { answerClient, CANT_HELP, contactBusiness, HELP_PAGES, helpClient } from "@/lib/support/clientHelp";
import { recordClientQuestion } from "@/lib/support/clientQuestions";

export const maxDuration = 60;

const Body = z.object({
  clientId: z.string().min(1).max(64),
  // The emails page's signed link (lib/reminders.ts), for a client who opened it without their personal link on this device.
  s: z.string().max(200).optional(),
  page: z.enum(HELP_PAGES),
  videoId: z.string().regex(/^[a-z0-9]{6,40}$/).optional(),
  // The conversation so far lives in the browser; only a few turns come back, and never any video, reply or to-do.
  messages: z.array(z.object({ role: z.enum(["client", "assistant"]), text: z.string().trim().min(1).max(2000) })).min(1).max(12),
});

/**
 * The help chat on client pages. Answers from the client guide only, and never reaches SureFrame support: when it
 * can't help, it names the business whose link this is. Only the question's text and the business are kept
 * (lib/support/clientQuestions.ts), for the weekly digest.
 */
export const POST = handle(async (req: Request) => {
  await limitByIp("client-help", 30, 3600);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const question = parsed.success ? parsed.data.messages.at(-1) : null;
  if (!parsed.success || question?.role !== "client" || question.text.length > 1000) throw new HttpError(400, "Please write a question (up to 1,000 characters).");
  const { clientId, s, page, videoId, messages } = parsed.data;
  // Only the client whose link this is, on a device that opened it (or from their email's link), like their pages.
  const client = await helpClient(clientId, s);
  if (!client) throw new HttpError(404, "Open your personal link on this device to use help here.");
  const contact = await contactBusiness(client);
  // Short bursts and a daily allowance per client, so one person can't run up AI costs.
  const limited = `You've reached the limit for the help chat for now. ${contact}`;
  await rateLimit(`client-help:client:${client.id}`, 10, 600).catch(() => { throw new HttpError(429, limited); });
  // A Free business isn't paying for its clients' help either: a few questions a day each, and a
  // ceiling for all its clients together.
  const free = client.workspace.plan === "FREE";
  await rateLimit(`client-help-day:client:${client.id}`, free ? 5 : 40, 86400).catch(() => { throw new HttpError(429, limited); });
  if (free) await rateLimit(`client-help-day:free-business:${client.workspaceId}`, 30, 86400).catch(() => { throw new HttpError(429, limited); });

  const reply = (text: string, answered: boolean) => Response.json({ reply: text, answered });
  if (!assistantEnabled() || !(await underDailyAiCap())) {
    await recordClientQuestion(client.workspaceId, question.text, "OFF", page);
    return reply(`The help chat can't answer right now. ${contact}`, false);
  }
  try {
    const { answer, outcome } = await answerClient(client, page, messages, videoId);
    await recordClientQuestion(client.workspaceId, question.text, outcome, page);
    return answer ? reply(answer, true) : reply(`${CANT_HELP} ${contact}`, false);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    console.error("[client-help] assistant failed", JSON.stringify({ workspace: client.workspaceId, status: err.status, message: err.message?.slice(0, 500) }));
    await recordClientQuestion(client.workspaceId, question.text, "FAILED", page);
    return reply(`Sorry, I hit a problem answering that. ${contact}`, false);
  }
});

/** A ceiling on answers per day across every client, apart from the business help chat's own. */
const underDailyAiCap = () => rateLimit("client-help-ai:global", Number(process.env.CLIENT_HELP_AI_DAILY_CAP ?? 1000), 86400).then(() => true, () => false);
