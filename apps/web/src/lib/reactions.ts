export const REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "🔥"] as const;

/** The reaction someone has left on a conversation, as a query (one at a time per person; older ones may have several). */
export const reactionsBy = (viewer: { kind: "member"; userId: string } | { kind: "client" }) =>
  viewer.kind === "member" ? { authorUserId: viewer.userId, byClient: false } : { authorUserId: null, byClient: true };
