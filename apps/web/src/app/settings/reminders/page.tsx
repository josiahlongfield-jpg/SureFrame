import { redirect } from "next/navigation";

/** Reminder settings moved to the To-dos/Reminders page; old links and emails still land there. */
export default function RemindersSettings() {
  redirect("/todos?tab=reminders");
}
