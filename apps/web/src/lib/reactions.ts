export const REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "🔥"] as const;

/** The reactions someone has left on a conversation, as a query (each person has each reaction at most once). */
export const reactionsBy = (viewer: { kind: "member"; userId: string } | { kind: "client" }) =>
  viewer.kind === "member" ? { authorUserId: viewer.userId, byClient: false } : { authorUserId: null, byClient: true };
