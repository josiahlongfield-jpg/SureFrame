// A stand-in for the Claude API so the support tests run offline. Start the
// app with ANTHROPIC_BASE_URL=http://localhost:12112 and any ANTHROPIC_API_KEY.
// The scripted assistant: "refund" hands over (urgent), "my plan" looks at the
// account first, "explode" fails, anything else gets a plain answer.
// Summary requests (structured output, for AI summaries) get a JSON summary
// that quotes the transcript's first line; a transcript containing "explode"
// fails.
// The client help chat (its system prompt holds the client guide): "explode" fails, "tax", "appointment" or "a person"
// can't be answered (cant_help), anything else gets a plain answer about replying.
import { createServer } from "node:http";

export const requests = [];
const msg = (content, stop_reason) => ({
  id: `msg_${Math.random().toString(36).slice(2)}`, type: "message", role: "assistant", model: "claude-opus-5-5",
  content, stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
});
const text = (t) => ({ type: "text", text: t });
const tool = (name, input) => ({ type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2)}`, name, input });

function reply(body) {
  const msgs = body.messages;
  if (body.output_config?.format?.type === "json_schema") {
    const transcript = String(msgs[0]?.content ?? "");
    if (/explode/i.test(transcript)) return null;
    const first = transcript.split("\n").find((l) => /^\[\d+:\d\d\]/.test(l))?.replace(/^\[\d+:\d\d\]\s*/, "") ?? "";
    const summary = { overview: `The video covers: ${first}`, keyPoints: ["Fake key point one", "Fake key point two"], actionItems: ["Send the signed form by Friday"] };
    return msg([text(JSON.stringify(summary))], "end_turn");
  }
  const last = msgs[msgs.length - 1];
  // A user's words are a string, or text blocks (the latest carries the cache marker); tool results aren't words.
  const words = (m) => (typeof m.content === "string" ? m.content : m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"));
  const lastUser = words([...msgs].reverse().find((m) => m.role === "user" && words(m)) ?? { content: "" });
  if ([].concat(body.system ?? []).some((b) => (typeof b === "string" ? b : b.text)?.includes("<client_help_guide>"))) {
    if (/explode/i.test(lastUser)) return null;
    if (/tax|appointment|a person/i.test(lastUser)) return msg([tool("cant_help", { reason: "needs_the_business" })], "tool_use");
    return msg([text("To reply, open the video and use the reply box: choose Text, Video or Voice.")], "end_turn");
  }
  if (Array.isArray(last.content) && last.content[0]?.type === "tool_result") {
    const result = last.content[0].content;
    if (result.startsWith("{")) return msg([text(`You're on the ${JSON.parse(result).plan} plan.`)], "end_turn");
    return msg([text("I've passed this to the team. A person will reply by email.")], "end_turn");
  }
  if (/explode/i.test(lastUser)) return null;
  if (/refund/i.test(lastUser)) return msg([tool("hand_to_human", { summary: "Customer wants a refund for a double charge.", urgent: true })], "tool_use");
  if (/my plan/i.test(lastUser)) return msg([tool("account_overview", {})], "tool_use");
  return msg([text("To add a client, open the Clients page and use Add client.")], "end_turn");
}

export function startFakeAnthropic(port = 12112) {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      requests.push({ url: req.url, headers: req.headers, body });
      const out = reply(body);
      if (!out) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "boom" } }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}
