/**
 * Set in the browser by an invite page (components/JoinTeam.tsx), holding the invite's token: this browser came to
 * join a team, so signing in here mustn't make a Free business of its own on the way (Decision 4, lib/session.ts
 * mayStartFree), and /start can lead back to the invite. Not a secret, and it only ever holds back, never grants.
 */
export const JOINING_COOKIE = "sf_joining";
