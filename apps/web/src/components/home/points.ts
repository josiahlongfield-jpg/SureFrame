/**
 * The six points on the home page's first screen (wording chosen by the owner, October 2026). The add-ons point says
 * they're paid and that videos are otherwise kept for a set time (V5, V6), and phones are camera only (V27).
 */
export function points(retentionDays: number) {
  return [
    { icon: "shield", title: "Crash-safe recording", line: "Uploads as you record, with a copy on your device until the upload finishes." },
    { icon: "lock", title: "End-to-end encrypted", line: "Only you, your team and your chosen clients can watch. Not even us.", coral: true },
    { icon: "noAccount", title: "No account or expense for clients", line: "They watch and reply straight from a private link, never pay and never see third-party ads." },
    { icon: "ai", title: "Paid add-ons: AI and backup", line: `AI pulls out key points and action items. Backup keeps videos past the usual ${retentionDays} days.` },
    { icon: "bolt", title: "Ready when you are", line: "No processing wait. Send it straight away." },
    { icon: "browser", title: "Nothing to install", line: "Works in the browser on a computer or phone (camera only on phones)." },
  ] as const;
}
