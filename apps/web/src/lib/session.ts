import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Membership, Role, User } from "@prisma/client";
import { db, type Workspace } from "@/lib/db";
import { agreementKind, hasAgreed, noticePeriod, TERMS_REQUIRED } from "@/lib/terms";
import { setViewerZone, TZ_COOKIE } from "@/lib/dates";
import { JOINING_COOKIE } from "@/lib/joining";
import { hashToken } from "@/lib/team";

/** Shown to staff the plan no longer covers (lib/seatLimits.ts). */
export const STAFF_PAUSED = "Your access to this team is paused because its plan changed. Ask the owner to restore it.";
/**
 * Refused while SureFrame support has suspended the workspace or this login
 * (lib/support/admin.ts). A 403, so unfinished uploads stay on the device and
 * carry on once it's lifted.
 */
export const ACCOUNT_SUSPENDED = "This account is suspended. Nothing has been deleted. Contact support@sureframe.app.";
/** A login whose account support closed (lib/support/admin.ts closeAccount). Unlike a self-closed account, it can't be kept. */
export const ACCOUNT_CLOSED_BY_SUPPORT = "SureFrame support closed this account. Contact support@sureframe.app.";

/** Suspended by support: this login everywhere ("user"), or the workspace it's working in. Closed counts as suspended. */
export const suspensionOf = (user: Pick<User, "suspendedAt">, workspace: Pick<Workspace, "suspendedAt" | "closedAt">) =>
  user.suspendedAt ? ("user" as const) : workspace.suspendedAt || workspace.closedAt ? ("workspace" as const) : null;

export class HttpError extends Error {
  /** `code` goes in the JSON too, for callers that act on the kind of error (e.g. ACCOUNT_SUSPENDED). */
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/**
 * Whether a login with no business yet gets a Free one of its own on first use (Decision 4, Josiah, 22 October 2026:
 * "we don't want staff members being able to make free owner accounts of their own, if they want their own business
 * they need to pay for their own subscription separate to the one they are staffed in"). Someone who signed up on
 * their own does, as before. Someone who joined a team from an invite (now, or ever: the accepted invite is kept after
 * they leave or are removed) or whose browser is on its way to join one doesn't: they get app/start, where their own
 * business starts on a paid plan (api/billing/start-business; the workspace is made once it's paid, lib/newBusiness.ts).
 * Existing workspaces are never touched: this only decides whether a new one is made.
 */
export async function mayStartFree(userId: string) {
  // Only an invite that can still be used holds a Free business back: one since used, cancelled or expired (or whose
  // team is gone) no longer does, so nobody is left stuck on the paid-only Start page for the cookie's day (Fable).
  const token = (await cookies()).get(JOINING_COOKIE)?.value;
  if (token) {
    const invite = await db.invite.findUnique({ where: { tokenHash: hashToken(token) }, select: { revokedAt: true, acceptedAt: true, expiresAt: true, workspace: { select: { suspendedAt: true, closedAt: true, deleteAt: true } } } });
    const live = invite && !invite.revokedAt && !invite.acceptedAt && invite.expiresAt > new Date() && !invite.workspace.suspendedAt && !invite.workspace.closedAt && !invite.workspace.deleteAt;
    if (live) return false;
  }
  return !(await db.invite.count({ where: { acceptedById: userId } }));
}

/**
 * A signed-in login that belongs to no business and isn't given a Free one (mayStartFree): currentUser() is null for
 * it, and pages send it to /start rather than to the sign-in page. Null for everyone else.
 */
export const withoutBusiness = cache(async () => {
  const userId = (await auth())?.user?.id;
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, deleteAt: true, _count: { select: { memberships: true } } } });
  if (!user || user.deleteAt || user._count.memberships > 0) return null;
  return (await mayStartFree(user.id)) ? null : user;
});

/** Where a login without a business goes (app/start). */
export const NO_BUSINESS = "You're not part of a business on SureFrame yet. Join your team from its invite link, or start your own business on a paid plan.";

/**
 * The signed-in user and their active workspace. Someone who signed up on their own gets a personal workspace on
 * first use, so they can record immediately; someone who joined a team from an invite doesn't (mayStartFree), and
 * this is null for them until they're on a team or have paid for their own business (withoutBusiness). Cached for the
 * request, so a page and its metadata don't each look it up (or create one).
 * A closed account waiting to be deleted counts as signed out, on every
 * device (see pendingDeletion). A suspended login or workspace still gets
 * here, flagged `suspended`, so the suspended page, help chat and data
 * download work; requireUser and requirePageUser keep it out of everything else.
 * So does someone who hasn't agreed to the current Terms and Privacy Policy
 * (`agreed` false, lib/terms.ts), until they do on /agree. An existing account
 * holder in the notice period of new versions counts as agreed meanwhile, with
 * `termsNotice` set for the banner asking them to agree.
 */
export const currentUser = cache(async () => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  // Times on this request's pages follow the viewer's own clock (lib/dates.ts).
  setViewerZone((await cookies()).get(TZ_COOKIE)?.value);
  // Awaited one after the other: in development React shows what a Promise.all resolved to in the page
  // (debug info), which would put support's internal notes on the workspace into the HTML.
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { memberships: { include: { workspace: true }, orderBy: { id: "asc" } } },
  });
  if (!user || user.deleteAt) return null;
  const agreedNow = await hasAgreed(userId);
  const termsNotice = agreedNow ? null : await noticePeriod(user);
  const agreed = agreedNow || !!termsNotice;
  // The workspace they last joined or switched to, else their first one they can still use.
  const membership =
    user.memberships.find((m) => m.workspaceId === user.activeWorkspaceId) ??
    user.memberships.find((m) => !m.pausedAt && !m.workspace.suspendedAt && !m.workspace.closedAt) ??
    user.memberships.find((m) => !m.workspace.suspendedAt && !m.workspace.closedAt) ??
    user.memberships[0];
  if (membership) {
    const { workspace, ...m } = membership;
    // Staff over the plan's limits (lib/seatLimits.ts) can't use the team until restored.
    return { user, workspace, role: membership.role, membership: m as Membership, paused: !!membership.pausedAt, suspended: suspensionOf(user, workspace), agreed, termsNotice };
  }
  // Staff from an invite get no Free business of their own (Decision 4): app/start instead.
  if (!(await mayStartFree(user.id))) return null;
  // One at a time per user, so two tabs opening at once can't make two personal workspaces.
  const made = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"personal:" + user.id}))`;
    const existing = await tx.membership.findFirst({ where: { userId: user.id }, include: { workspace: true }, orderBy: { id: "asc" } });
    if (existing) return existing;
    const workspace = await tx.workspace.create({
      data: {
        name: `${user.name ?? user.email.split("@")[0]}'s workspace`,
        members: { create: { userId: user.id, role: "OWNER" } },
      },
      include: { members: true },
    });
    const { members, ...ws } = workspace;
    return { ...members[0], workspace: ws };
  });
  const { workspace, ...m } = made;
  return { user, workspace, role: m.role, membership: m as Membership, paused: !!m.pausedAt, suspended: suspensionOf(user, workspace), agreed, termsNotice };
});

/** Throws unless the signed-in member has one of the given roles. */
export function requireRole(me: { role: Role }, ...roles: Role[]) {
  if (!roles.includes(me.role)) throw new HttpError(403, me.role === "MEMBER" ? "Ask an admin of this workspace to do this" : "Only the workspace owner can do this");
}

/** Refused until they agree to the current Terms and Privacy Policy on /agree (lib/terms.ts). */
export const termsRequired = () => new HttpError(403, TERMS_REQUIRED, "TERMS_REQUIRED");

/**
 * The signed-in member, or a 401/403. `allowSuspendedOwner` lets the owner of
 * a suspended workspace, or an owner whose own login is suspended, reach what
 * the suspended page offers (managing or cancelling the subscription); a
 * suspended staff login never gets through. `allowTermsPending` lets someone
 * who hasn't agreed to the current terms yet finish an upload they'd already
 * started, or manage or cancel their subscription.
 */
export async function requireUser({ allowSuspendedOwner = false, allowTermsPending = false } = {}) {
  const me = await currentUser();
  if (!me) throw (await withoutBusiness()) ? new HttpError(403, NO_BUSINESS, "NO_BUSINESS") : new HttpError(401, "Sign in required");
  if (me.suspended && !(allowSuspendedOwner && (me.suspended === "workspace" || (me.role === "OWNER" && !me.user.closedAt))))
    throw new HttpError(403, ACCOUNT_SUSPENDED, "ACCOUNT_SUSPENDED");
  if (me.paused) throw new HttpError(403, STAFF_PAUSED);
  if (!me.agreed && !allowTermsPending) throw termsRequired();
  return me;
}

/**
 * The signed-in browser's account when it is closed and waiting to be deleted
 * (lib/accountDeletion.ts). Only a sign-in made after it was closed ("fresh")
 * may keep it, so a browser left signed in elsewhere can't.
 */
export const pendingDeletion = cache(async () => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, deleteAt: true, deletionRequestedAt: true, suspendedAt: true, closedAt: true },
  });
  if (!user?.deleteAt) return null;
  const fresh = !!user.deletionRequestedAt && (session.signedInAt ?? 0) > user.deletionRequestedAt.getTime();
  // Closed by SureFrame support (closedAt), or suspended since: only support can change that (lib/support/admin.ts).
  return { ...user, deleteAt: user.deleteAt, fresh };
});

/** Where someone goes to agree to the current terms, coming back to `next` afterwards. */
export const agreePath = (next: string) => `/agree?next=${encodeURIComponent(next)}`;

/** Where a new owner gives their name and business name, coming back to `next` afterwards (app/welcome). */
export const welcomePath = (next: string) => `/welcome?next=${encodeURIComponent(next)}`;

/** A new owner who hasn't done the one-step welcome yet. Staff are never asked: their business already has a name. */
export const needsWelcome = (me: { role: Role; user: Pick<User, "onboardedAt"> }) => me.role === "OWNER" && !me.user.onboardedAt;

/**
 * `allowTermsPending`: true lets anyone who hasn't agreed to the current terms in; "existing" only an account
 * that agreed to an earlier version (it may have data to download or a subscription to cancel). Someone who has
 * never agreed, like a new sign-up or a person on their way to join a team, goes to /agree like everywhere else.
 */
export async function requirePageUser(
  next = "/library",
  { allowPaused = false, allowSuspended = false, allowTermsPending = false as boolean | "existing", allowWelcome = false } = {},
) {
  const me = await currentUser();
  if (!me) {
    // A closed account just signed in again: offer to keep it.
    if ((await pendingDeletion())?.fresh) redirect("/account/restore");
    // Signed in, but on no team and with no business of their own (Decision 4).
    if (await withoutBusiness()) redirect("/start");
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  // Suspended by support (lib/support/admin.ts): only the suspended page, help and the support console.
  if (me.suspended && !allowSuspended) redirect("/suspended");
  // Paused staff can still reach their own account (to download their data or delete it).
  if (me.paused && !allowPaused) redirect("/paused");
  // Not agreed to the current Terms and Privacy Policy yet (lib/terms.ts): only /agree, their account
  // page (to download their data or delete it) and the support console.
  if (!me.agreed && (!allowTermsPending || (allowTermsPending === "existing" && (await agreementKind(me.user)) !== "update"))) redirect(agreePath(next));
  // Just signed up: the business name clients will see, and their own (app/welcome). Every app page waits for it,
  // Settings > Account and Billing too, so none shows the "<email>'s workspace" placeholder as a business (O4, O11).
  // The support console (allowSuspended) is left alone.
  if (me.agreed && needsWelcome(me) && !allowWelcome && !allowSuspended) redirect(welcomePath(next));
  return me;
}

/** Wrap a route handler so thrown HttpErrors become JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, { status: err.status });
      // A missing or malformed JSON body (req.json()) is the caller's mistake, not ours.
      if (err instanceof SyntaxError) return Response.json({ error: "Invalid request body" }, { status: 400 });
      // One line with the route, so it can be found and alerted on in the logs.
      const req = args[0] instanceof Request ? args[0] : null;
      const e = err as { name?: string; message?: string; stack?: string };
      console.error(JSON.stringify({ level: "error", route: req ? new URL(req.url).pathname : null, method: req?.method ?? null, name: e?.name, message: String(e?.message ?? err).slice(0, 1000), stack: e?.stack?.slice(0, 3000) }));
      return Response.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

/**
 * Team email links carry ?ws=<workspace id>. Someone on more than one team
 * opens the team the email was about, not whichever one they had open last.
 */
export async function followTeamLink(ws: string | undefined, path: string) {
  if (!ws) return;
  const me = await currentUser();
  if (!me || me.workspace.id === ws) return;
  if (!me.user.memberships.some((m) => m.workspaceId === ws && !m.pausedAt)) return;
  await db.user.update({ where: { id: me.user.id }, data: { activeWorkspaceId: ws } });
  redirect(path);
}
