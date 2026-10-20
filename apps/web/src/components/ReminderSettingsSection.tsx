import ReminderSettings from "./ReminderSettings";
import MyReminderSettings from "./MyReminderSettings";
import { reminderDefaultsFor, workspaceReminderDefaults } from "@/lib/reminders";
import type { Membership, Role, Workspace } from "@prisma/client";

/**
 * When to-do reminders go out and what clients' reminder emails say: the business's settings for owners and
 * admins, a staff member's own for the clients they look after. On the To-dos/Reminders page (src/app/todos).
 */
export default function ReminderSettingsSection({ workspace, role, membership }: { workspace: Omit<Workspace, "brandLogo">; role: Role; membership: Membership | null | undefined }) {
  const d = workspaceReminderDefaults(workspace);
  return (
    <>
      {role === "MEMBER" ? (
        <>
          <p className="mt-1 text-sm text-dim">
            Your own reminder settings for the clients you look after: which reminders your new to-dos start with, and the message and reply-to address on your clients&apos; emails. Anything you leave
            blank uses {workspace.name}&apos;s settings.
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
            Choose how your business appears in reminder emails and which reminders new to-dos start with. You can still change them on any to-do. Staff can set their own defaults, message and
            reply-to for the clients they look after; where they don&apos;t, these apply.
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
    </>
  );
}
