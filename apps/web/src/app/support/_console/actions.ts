"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/session";
import {
  blockEmail,
  closeAccount,
  currentSupportAdmin,
  disableClientLink,
  enableClientLink,
  NOTICE_REASONS,
  reopenAccount,
  setLegalHold,
  signOutEverywhere,
  suspendUser,
  suspendWorkspace,
  unsuspendUser,
  unsuspendWorkspace,
  warn,
  type NoticeReason,
  type SupportAdmin,
} from "@/lib/support/admin";
import {
  cancelScheduledDeletion,
  deleteAccountNow,
  deleteRemovedClientNow,
  rerunSeatCheck,
  resyncBilling,
  setFreeVideosUsed,
  unblockEmailAndTell,
} from "@/lib/support/console";
import { createOffer, endOffer, stopAutomaticOffer, MAX_OFFER_MONTHS, OWN_BUSINESS } from "@/lib/support/offers";

/**
 * What a support console form shows after it's sent: only errors (success goes to the page's "Done" banner). `own`:
 * refused because it's aimed at the admin's own business; the form then offers a box to go ahead anyway (P30).
 */
export type PowerResult = { ok: false; message: string; own?: boolean } | null;

const id = z.string().min(1).max(64);
const reason = z
  .string({ error: "Write the reason for this (it's kept in the support log, not shown to the customer)." })
  .trim()
  .min(1, "Write the reason for this (it's kept in the support log, not shown to the customer).")
  .max(500, "Keep the reason to 500 characters or fewer.");
const category = z.enum(Object.keys(NOTICE_REASONS) as [NoticeReason, ...NoticeReason[]], { error: "Choose the reason the email gives." });
/** A checkbox: sent as "on" when ticked, missing when not. */
const box = z
  .literal("on")
  .optional()
  .transform((v) => v === "on");
const note = z.string().max(1000, "Keep the note to 1000 characters or fewer.").optional();
const confirm = z.string().max(400).default("");
const email = z.string().trim().toLowerCase().max(320).email("Enter an email address.");

const Power = z.discriminatedUnion("power", [
  z.object({ power: z.literal("warn"), workspaceId: id.optional(), userId: id.optional(), reason, category, message: note }),
  z.object({ power: z.literal("suspendWorkspace"), workspaceId: id, reason, category, note, notify: box, stopRenewal: box }),
  z.object({ power: z.literal("unsuspendWorkspace"), workspaceId: id, reason, notify: box, resumeRenewal: box }),
  z.object({ power: z.literal("suspendUser"), userId: id, reason, category, notify: box }),
  z.object({ power: z.literal("unsuspendUser"), userId: id, reason, notify: box }),
  z.object({ power: z.literal("closeAccount"), userId: id, reason, category, confirm, notify: box, blockEmail: box, legalHold: box }),
  z.object({ power: z.literal("reopenAccount"), userId: id, reason, notify: box }),
  z.object({ power: z.literal("legalHoldOn"), workspaceId: id, reason }),
  z.object({ power: z.literal("legalHoldOff"), workspaceId: id, reason }),
  z.object({ power: z.literal("linkOff"), clientId: id, reason, category, notify: box }),
  z.object({ power: z.literal("linkOn"), clientId: id, reason, notify: box }),
  z.object({ power: z.literal("signOutEverywhere"), userId: id, reason, notify: box }),
  z.object({ power: z.literal("deleteAccountNow"), userId: id, reason, confirm, notify: box }),
  z.object({ power: z.literal("cancelDeletion"), userId: id, reason, notify: box }),
  z.object({ power: z.literal("deleteClientNow"), clientId: id, reason, confirm, notify: box }),
  z.object({
    power: z.literal("setVideosRecorded"),
    workspaceId: id,
    value: z.coerce.number({ error: "Enter a whole number, 0 or more." }).int("Enter a whole number, 0 or more.").min(0, "Enter a whole number, 0 or more.").max(1_000_000),
    reason,
    notify: box,
  }),
  z.object({ power: z.literal("resyncBilling"), workspaceId: id, reason, notify: box }),
  z.object({ power: z.literal("seatCheck"), workspaceId: id, reason, notify: box }),
  z.object({ power: z.literal("blockEmail"), email, reason, category: category.optional(), notify: box }),
  z.object({ power: z.literal("unblockEmail"), email, reason, notify: box }),
  z.object({
    power: z.literal("createOffer"),
    email,
    code: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(40).optional()),
    percentOff: z.coerce.number({ error: "Enter a percentage from 1 to 100." }).int("Enter a whole percentage.").min(1, "Enter a percentage from 1 to 100.").max(100, "Enter a percentage from 1 to 100."),
    duration: z.enum(["once", "repeating", "forever"], { error: "Choose how long the discount lasts." }),
    months: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1, `Enter how many months, 1 to ${MAX_OFFER_MONTHS}.`).max(MAX_OFFER_MONTHS, `Enter how many months, 1 to ${MAX_OFFER_MONTHS}.`).optional()),
    scope: z.enum(["plan", "seats", "all"], { error: "Choose what it comes off." }),
    lastDay: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the last day it can be used.").optional()),
    reason,
    own: box,
  }),
  z.object({ power: z.literal("endOffer"), promotionCodeId: id, reason }),
  z.object({ power: z.literal("autoOfferOff"), promotionCodeId: id, reason }),
]);
type Power = z.infer<typeof Power>;

const wsPage = (workspaceId: string) => `/support/workspaces/${workspaceId}`;
const userPage = (userId: string) => `/support/users/${userId}`;
const clientPage = async (clientId: string) => {
  const c = await db.client.findUnique({ where: { id: clientId }, select: { workspaceId: true } });
  return c ? wsPage(c.workspaceId) : "/support/log";
};
const emailPage = async (address: string) => {
  const u = await db.user.findUnique({ where: { email: address }, select: { id: true } });
  return u ? userPage(u.id) : `/support/lookup?q=${encodeURIComponent(address)}`;
};

/** Runs one power; returns its support-log row and the console page to show afterwards. */
async function dispatch(a: SupportAdmin, p: Power): Promise<{ actionId: string; back: string }> {
  switch (p.power) {
    case "warn": {
      if (!p.workspaceId && !p.userId) throw new HttpError(400, "Nobody to warn");
      const r = await warn(a, p);
      return { actionId: r.actionId, back: p.workspaceId ? wsPage(p.workspaceId) : userPage(p.userId!) };
    }
    case "suspendWorkspace":
      return { actionId: (await suspendWorkspace(a, p)).actionId, back: wsPage(p.workspaceId) };
    case "unsuspendWorkspace":
      return { actionId: (await unsuspendWorkspace(a, p)).actionId, back: wsPage(p.workspaceId) };
    case "suspendUser":
      return { actionId: (await suspendUser(a, p)).actionId, back: userPage(p.userId) };
    case "unsuspendUser":
      return { actionId: (await unsuspendUser(a, p)).actionId, back: userPage(p.userId) };
    case "closeAccount":
      return { actionId: (await closeAccount(a, p)).actionId, back: userPage(p.userId) };
    case "reopenAccount":
      return { actionId: (await reopenAccount(a, p)).actionId, back: userPage(p.userId) };
    case "legalHoldOn":
    case "legalHoldOff":
      return { actionId: (await setLegalHold(a, { workspaceId: p.workspaceId, reason: p.reason, on: p.power === "legalHoldOn" })).actionId, back: wsPage(p.workspaceId) };
    case "linkOff": {
      const back = await clientPage(p.clientId);
      return { actionId: (await disableClientLink(a, p)).actionId, back };
    }
    case "linkOn": {
      const back = await clientPage(p.clientId);
      return { actionId: (await enableClientLink(a, p)).actionId, back };
    }
    case "signOutEverywhere":
      return { actionId: (await signOutEverywhere(a, p)).actionId, back: userPage(p.userId) };
    case "deleteAccountNow":
      // The account's page is gone afterwards.
      return { actionId: (await deleteAccountNow(a, p)).actionId, back: "/support/log" };
    case "cancelDeletion":
      return { actionId: (await cancelScheduledDeletion(a, p)).actionId, back: userPage(p.userId) };
    case "deleteClientNow": {
      const back = await clientPage(p.clientId);
      return { actionId: (await deleteRemovedClientNow(a, p)).actionId, back };
    }
    case "setVideosRecorded":
      return { actionId: (await setFreeVideosUsed(a, p)).actionId, back: wsPage(p.workspaceId) };
    case "resyncBilling":
      return { actionId: (await resyncBilling(a, p)).actionId, back: wsPage(p.workspaceId) };
    case "seatCheck":
      return { actionId: (await rerunSeatCheck(a, p)).actionId, back: wsPage(p.workspaceId) };
    case "blockEmail":
      return { actionId: (await blockEmail(a, p)).actionId, back: await emailPage(p.email) };
    case "unblockEmail":
      return { actionId: (await unblockEmailAndTell(a, p)).actionId, back: await emailPage(p.email) };
    case "createOffer":
      return { actionId: (await createOffer(a, p)).actionId, back: "/support/offers" };
    case "endOffer":
      return { actionId: (await endOffer(a, p)).actionId, back: "/support/offers" };
    case "autoOfferOff":
      return { actionId: (await stopAutomaticOffer(a, p)).actionId, back: "/support/offers" };
  }
}

/**
 * Every support console form posts here. Support admins only; the power
 * itself checks the reason, the typed confirmation and that it isn't aimed at
 * the admin's own login or workspace, and records itself in the support log.
 * On success the page reloads with a "Done" banner read from that record.
 */
export async function runPower(_prev: PowerResult, form: FormData): Promise<PowerResult> {
  const admin = await currentSupportAdmin();
  if (!admin) return { ok: false, message: "Not found" };
  const fields = Object.fromEntries([...form.entries()].filter(([k, v]) => !k.startsWith("$") && typeof v === "string"));
  const parsed = Power.safeParse(fields);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  let done: { actionId: string; back: string };
  try {
    done = await dispatch(admin, parsed.data);
  } catch (err) {
    if (err instanceof HttpError) return { ok: false, message: err.message, ...(err.code === OWN_BUSINESS ? { own: true } : {}) };
    console.error(
      JSON.stringify({ level: "error", message: "[support-console] power failed", power: parsed.data.power, error: String((err as Error)?.message ?? err).slice(0, 1000) }),
    );
    return {
      ok: false,
      message: `Something went wrong (${String((err as Error)?.message ?? err).slice(0, 200)}). Check the status above and the support log before trying again.`,
    };
  }
  revalidatePath("/support", "layout");
  redirect(`${done.back}${done.back.includes("?") ? "&" : "?"}done=${done.actionId}`);
}
