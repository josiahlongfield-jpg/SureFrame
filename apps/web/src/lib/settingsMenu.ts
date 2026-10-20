import type { Plan } from "@prisma/client";
import { TEAM_PLANS } from "@/lib/plans";

/** One settings page: where it is, its name in the Settings menu, and a line on what it's for (the /settings page). */
export type SettingsPage = { href: string; label: string; blurb: string };

/**
 * The settings pages someone can use, in menu order: the header's Settings menu and the /settings page both list
 * these. Staff don't get Billing or Branding (only owners and admins can change them). The support team also gets
 * the support pages, so they're reached from here rather than by typing the address.
 */
export function settingsPages({
  manager,
  teamSize,
  plan,
  workspaces,
  supportAgent = false,
}: {
  manager: boolean;
  teamSize: number;
  plan: Plan;
  workspaces: number;
  supportAgent?: boolean;
}): SettingsPage[] {
  const support: SettingsPage[] = supportAgent ? [{ href: "/support", label: "Support", blurb: "The support console: help conversations, accounts and discount codes." }] : [];
  // A team plan keeps its team pages while the owner is on their own; a business of one on another plan has none.
  const teamPages = teamSize > 1 || (manager && TEAM_PLANS.includes(plan));
  if (manager) {
    return [
      { href: "/settings/branding", label: "Branding", blurb: "Your business name, logo and colour on the pages and emails your clients see." },
      teamPages
        ? { href: "/settings/team", label: "Team and staff", blurb: "Invite staff, choose their roles and what each person can see and do." }
        : { href: "/settings/team", label: "Invite staff", blurb: "Invite people to work with you, and see which plans include staff logins." },
      { href: "/settings/billing", label: "Billing", blurb: "Your plan, what you pay, add-ons, discount codes, and where to find receipts and invoices." },
      { href: "/settings/account", label: "Account", blurb: "Your name, recovery key, emails you get, downloading your data and deleting your account." },
      ...support,
    ];
  }
  return [
    { href: "/settings/account", label: "Account", blurb: "Your name, emails you get, downloading your data and deleting your account." },
    ...(workspaces > 1 ? [{ href: "/settings/team", label: "Switch business", blurb: "The businesses you're part of, and switching between them." }] : []),
    ...support,
  ];
}
