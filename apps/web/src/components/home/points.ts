/**
 * The six points on the home page's first screen (wording chosen by the owner, October 2026). The add-ons point says
 * they're paid and that videos are otherwise kept for a set time (V5, V6). The Claude point is the free connector
 * (lib/claudeBonus.ts).
 */
export function points(retentionDays: number) {
  return [
    { icon: "shield", title: "Saved as you record", line: "Uploads as you record, with a copy on your device until the upload finishes." },
    { icon: "lock", title: "End-to-end encrypted", line: "Only your team and the clients you send to can watch. Not even us.", coral: true },
    { icon: "noAccount", title: "No account or expense for clients", line: "They watch and reply straight from their personal link, never pay and never see third-party ads." },
    { icon: "ai", title: "Paid add-ons: AI and backup", line: `AI pulls out key points and action items. Backup keeps videos past the usual ${retentionDays} days.` },
    { icon: "bolt", title: "Ready when you are", line: "No processing wait. Send it straight away." },
    // Was "Nothing to install", no longer true with the browser extension (Josiah, 22 October 2026).
    { icon: "plug", title: "Free bonus for Claude users", line: "Connect your Claude account for client reports, checklists and more, at no extra charge." },
  ] as const;
}
