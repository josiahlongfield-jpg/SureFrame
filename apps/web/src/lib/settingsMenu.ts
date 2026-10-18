/** One settings page: where it is, its name in the Settings menu, and a line on what it's for (the /settings page). */
export type SettingsPage = { href: string; label: string; blurb: string };

/**
 * The settings pages someone can use, in menu order: the header's Settings menu and the /settings page both list
 * these. Staff don't get Billing or Branding (only owners and admins can change them).
 */
export function settingsPages({ manager, teamSize, workspaces }: { manager: boolean; teamSize: number; workspaces: number }): SettingsPage[] {
  if (manager) {
    return [
      { href: "/settings/reminders", label: "Reminders", blurb: "When to-do reminders go out, and the message and reply-to address on your clients' reminder emails." },
      { href: "/settings/branding", label: "Branding", blurb: "Your business name, logo and colour on the pages and emails your clients see." },
      teamSize > 1
        ? { href: "/settings/team", label: "Team and staff", blurb: "Invite staff, choose their roles and what each person can see and do." }
        : { href: "/settings/team", label: "Invite staff", blurb: "Invite people to work with you, and see which plans include staff logins." },
      { href: "/settings/billing", label: "Billing", blurb: "Your plan, add-ons, discount codes and invoices." },
      { href: "/settings/account", label: "Account", blurb: "Your name, recovery key, emails you get, downloading your data and deleting your account." },
    ];
  }
  return [
    { href: "/settings/reminders", label: "Reminders", blurb: "Your own reminder settings for the clients you look after." },
    { href: "/settings/account", label: "Account", blurb: "Your name, emails you get, downloading your data and deleting your account." },
    ...(workspaces > 1 ? [{ href: "/settings/team", label: "Your workspaces", blurb: "The teams you're part of, and switching between them." }] : []),
  ];
}
