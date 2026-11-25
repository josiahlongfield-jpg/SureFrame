export const REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "🔥"] as const;

/** What each reaction is called, in the same order, for screen readers (the team's "reacted:" line). */
const NAMES = ["thumbs up", "heart", "laughing", "celebration", "eyes", "fire"];
export const reactionName = (emoji: string) => NAMES[(REACTIONS as readonly string[]).indexOf(emoji)] ?? emoji;

/** The reaction someone has left on a conversation, as a query (one at a time per person; older ones may have several). */
export const reactionsBy = (viewer: { kind: "member"; userId: string } | { kind: "client" }) =>
  viewer.kind === "member" ? { authorUserId: viewer.userId, byClient: false } : { authorUserId: null, byClient: true };
