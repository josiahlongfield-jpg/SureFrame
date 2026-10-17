import type { Plan } from "@prisma/client";

export type PlanLimits = {
  name: string;
  priceMonthly: number;
  /** Paying yearly gets two months free. */
  priceYearly: number;
  /**
   * Videos in total for the life of the workspace (not per month), or null for unlimited.
   * Every original that finished uploading counts, on any plan, and deleting one doesn't
   * give its place back. Replies and copies sent to more clients don't count.
   */
  maxVideos: number | null;
  maxDurationMin: number;
  maxResolution: 720 | 1080 | 2160;
  /** Client accounts included. Clients watch and reply for free; more can be bought. */
  clientSeats: number;
  /** Staff who can sign in to the workspace, the owner included. */
  staffSeats: number;
  /** Clients see a short SureFrame intro, once on each device for each business. Paid plans remove it. */
  showsPromo: boolean;
  features: string[];
};

export type Interval = "month" | "year";

/** Price of each extra client seat. */
export const EXTRA_SEAT_PRICE = 1.5;
export const EXTRA_SEAT_PRICE_YEARLY = 15;

/** Price of each extra staff member on Studio and Agency. */
export const EXTRA_STAFF_PRICE = 8;
export const EXTRA_STAFF_PRICE_YEARLY = 80;

/** Optional add-on: keep encrypted copies on our servers instead of the 30-day relay window. */
export const CLOUD_BACKUP_PRICE = 5;
export const CLOUD_BACKUP_PRICE_YEARLY = 50;

/**
 * Optional add-on: AI transcripts and summaries. Priced by plan; yearly is 10x
 * monthly. Not available on Free. Transcripts are made on the team's devices;
 * only the transcript text is sent to Claude to write the summary.
 */
export const AI_ASSIST_PRICES: Record<"SOLO" | "STUDIO" | "AGENCY", { month: number; year: number }> = {
  SOLO: { month: 8, year: 80 },
  STUDIO: { month: 15, year: 150 },
  AGENCY: { month: 29, year: 290 },
};

/** Fair-use cap on AI summaries per workspace per calendar month (UTC). */
export const AI_SUMMARIES_PER_MONTH: Record<"SOLO" | "STUDIO" | "AGENCY", number> = {
  SOLO: 100,
  STUDIO: 400,
  AGENCY: 1000,
};

/** Whether a workspace can use AI transcripts and summaries right now. */
export function aiAssistActive(w: { plan: Plan; aiAssist: boolean }) {
  return w.aiAssist && w.plan !== "FREE";
}

const paidFeatures = ["Unlimited videos", "Up to 4 hours per video", "1080p and 4K recording", "Custom branding", "No SureFrame intro before your videos", "Extra clients US$1.50/month each", "Optional cloud backup", "Optional AI transcripts and summaries"];

export const PLANS: Record<Plan, PlanLimits> = {
  FREE: {
    name: "Free",
    priceMonthly: 0,
    priceYearly: 0,
    maxVideos: 25,
    maxDurationMin: 5,
    maxResolution: 720,
    clientSeats: 3,
    staffSeats: 1,
    showsPromo: true,
    features: ["3 clients included", "25 videos in total", "Up to 5 minutes per video", "720p recording", "Video, voice and text replies", "End-to-end encrypted", "Clients see a short SureFrame intro, once on each device"],
  },
  SOLO: {
    name: "Solo",
    priceMonthly: 15,
    priceYearly: 150,
    maxVideos: null,
    maxDurationMin: 240,
    maxResolution: 2160,
    clientSeats: 10,
    staffSeats: 1,
    showsPromo: false,
    features: ["10 clients included", ...paidFeatures],
  },
  STUDIO: {
    name: "Studio",
    priceMonthly: 49,
    priceYearly: 490,
    maxVideos: null,
    maxDurationMin: 240,
    maxResolution: 2160,
    clientSeats: 40,
    staffSeats: 3,
    showsPromo: false,
    features: ["40 clients included", "3 staff logins (yours included)", "Assign clients to staff", "Choose what each staff member can see and do", "Team overview: replies waiting, videos sent, staff reminders", "Extra staff US$8/month each", "Everything in Solo"],
  },
  AGENCY: {
    name: "Agency",
    priceMonthly: 99,
    priceYearly: 990,
    maxVideos: null,
    maxDurationMin: 240,
    maxResolution: 2160,
    clientSeats: 100,
    staffSeats: 10,
    showsPromo: false,
    features: ["100 clients included", "10 staff logins (yours included)", "Assign clients to staff", "Choose what each staff member can see and do", "Team overview: replies waiting, videos sent, staff reminders", "Extra staff US$8/month each", "Everything in Solo"],
  },
};

/**
 * The plan cards' "Video storage" line. Without cloud backup a video's encrypted copy leaves our servers
 * `days` after it's recorded (lib/retention.ts); cloud backup is a paid-plan add-on.
 */
export function storageLine(plan: Plan, days: number) {
  return plan === "FREE"
    ? `Videos are kept on our servers for ${days} days after they're recorded, then deleted. Cloud backup isn't available on Free.`
    : `Videos are kept on our servers for ${days} days after they're recorded, unless Cloud backup is on (US$${CLOUD_BACKUP_PRICE} a month).`;
}

/** Longest video or voice reply a client can send. */
export const MAX_REPLY_MINUTES = 15;

/** Longest video or voice reply. The team's own replies keep to the plan's video length (5 minutes on Free). */
export function replyMaxMinutes(plan: Plan, byTeam: boolean) {
  return byTeam ? Math.min(MAX_REPLY_MINUTES, PLANS[plan].maxDurationMin) : MAX_REPLY_MINUTES;
}

export const PAID_PLANS = ["SOLO", "STUDIO", "AGENCY"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export function clientSeatLimit(w: { plan: Plan; extraClientSeats: number }) {
  return PLANS[w.plan].clientSeats + w.extraClientSeats;
}

/** Plans that can buy extra staff seats. */
export const TEAM_PLANS: Plan[] = ["STUDIO", "AGENCY"];

export function staffSeatLimit(w: { plan: Plan; extraStaffSeats: number }) {
  return PLANS[w.plan].staffSeats + (TEAM_PLANS.includes(w.plan) ? w.extraStaffSeats : 0);
}
