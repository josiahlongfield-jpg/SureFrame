/**
 * How the SureFrame connectors for Claude (lib/connector) are described on the home page, pricing, FAQ and in
 * Settings, in one place. Josiah (22 October 2026): a free bonus on every plan for people who already use Claude,
 * made clear as such. Every claim here is backed by what the connectors do: read-only, only what that person can see,
 * the online one sees no encrypted content, the desktop one unlocks on their own computer.
 */
export const CLAUDE_BONUS = {
  kicker: "Free bonus for Claude users",
  title: "Let Claude work alongside you.",
  /** The free bonus and the paid AI add-on in one line, so nobody thinks one needs the other (V4). */
  notTheAddOn:
    "The connector is free and uses your own Claude account. It's separate from our paid AI add-on, which writes transcripts and summaries inside SureFrame.",
  /** The pricing page's one short line about the bonus (V25); the home page has the full story. */
  pricingLine:
    "Already use Claude, Anthropic's AI assistant? Connect your own Claude account to SureFrame at no extra charge on every plan, and ask it for client reports, follow-up lists and more. It only reads, and only sees what you can see. It's separate from the paid AI add-on above.",
  /** Josiah's words, with Claude introduced as Anthropic's AI assistant the first time a page talks about it at length (V3) and "follow-up lists and more" for "checklists and much more" (22 October 2026). */
  blurb:
    "Already use Claude, Anthropic's AI assistant? Connect it to SureFrame free of charge and ask it for things to help streamline your service such as client reports, follow-up lists and more. It only reads, and only sees what you can see.",
  /** The AI add-on and the Claude Desktop connector together (Josiah: show the synergy, so people want both). */
  withAddOn:
    "Even better with our AI add-on: Claude Desktop can also read your videos' transcripts and summaries, so your reports include what was said in each video, not just who sent what and when.",
  /** Said beside the AI add-on, pointing back to the bonus. */
  addOnTeaser: "Use Claude? With our free Claude Desktop connector, Claude can read these transcripts and summaries too and use them in your reports.",
  privacy:
    "Your messages and notes stay end-to-end encrypted: the online connector can't read them, and the Claude Desktop connector unlocks them on your own computer.",
  /** Needs their own Claude account; Claude's plans decide which connectors they can add. */
  needs: "Uses your own Claude account. Claude's own plans and limits apply.",
  /** Not made by or affiliated with Anthropic: said wherever the bonus is promoted. */
  trademark: "Claude is a trademark of Anthropic. SureFrame isn't made by or affiliated with Anthropic.",
  settings: "Free bonus: connect Claude, Anthropic's AI assistant, for client reports, follow-up lists and more.",
};
