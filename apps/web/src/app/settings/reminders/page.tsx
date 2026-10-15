import type { Metadata } from "next";
import AppHeader from "@/components/AppHeader";
import ReminderSettings from "@/components/ReminderSettings";
import MyReminderSettings from "@/components/MyReminderSettings";
import { PLANS } from "@/lib/plans";
import { reminderDefaultsFor, workspaceReminderDefaults } from "@/lib/reminders";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "Reminders" };

export default async function RemindersSettings() {
  const { user, workspace, role, membership } = await requirePageUser("/settings/reminders");
  const d = workspaceReminderDefaults(workspace);
  return (
    <>
      <AppHeader email={user.email} plan={PLANS[workspace.plan].name} />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Reminders</h1>
        {role === "MEMBER" ? (
          <>
            <p className="mt-1 text-sm text-dim">
              Your own reminder settings for the clients you look after: which reminders your new to-dos start with, and the message and reply-to address on your clients&apos; emails.
              Anything you leave blank uses {workspace.name}&apos;s settings.
            </p>
            <MyReminderSettings
              business={{
                name: workspace.name,
                timezone: workspace.timezone,
                reminderMessage: workspace.reminderMessage ?? "",
                reminderReplyTo: workspace.reminderReplyTo ?? "",
                defaults: d,
              }}
              ownDefaults={membership?.myReminderDefaults != null || membership?.myRemindClientDefault != null || membership?.myRemindTeamDefault != null}
              defaults={reminderDefaultsFor(workspace, membership)}
              reminderMessage={membership?.myReminderMessage ?? ""}
              reminderReplyTo={membership?.myReminderReplyTo ?? ""}
            />
          </>
        ) : (
          <>
          <p className="mt-1 text-sm text-dim">
            Choose how your business appears in reminder emails and which reminders new to-dos start with. You can still change them on any to-do.
            Staff can set their own defaults, message and reply-to for the clients they look after; where they don&apos;t, these apply.
          </p>
        <ReminderSettings
          initial={{
            name: workspace.name,
            timezone: workspace.timezone,
            reminderDefaults: d.reminders,
            remindClientDefault: d.remindClient,
            remindTeamDefault: d.remindTeam,
            reminderMessage: workspace.reminderMessage ?? "",
            reminderReplyTo: workspace.reminderReplyTo ?? "",
          }}
        />
          </>
        )}
      </main>
    </>
  );
}
