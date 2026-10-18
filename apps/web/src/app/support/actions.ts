"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { activeSupportAgent } from "@/lib/support/admin";
import { staffReply } from "@/lib/support/tickets";

async function requireAgent() {
  if (!(await activeSupportAgent())) redirect("/library");
}

/** A person's reply. The page then says where it went ("sent"), or that the box was empty. */
export async function reply(ticketId: string, form: FormData) {
  await requireAgent();
  const body = String(form.get("body") ?? "").trim().slice(0, 8000);
  if (!body) redirect(`/support/${ticketId}?error=empty`);
  const ticket = await db.supportTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { user: { select: { email: true } } } });
  const emailed = await staffReply(ticket, body);
  revalidatePath(`/support/${ticketId}`);
  revalidatePath("/support");
  redirect(`/support/${ticketId}?sent=${emailed ? "email" : "chat"}`);
}

/**
 * Close (it moves to the inbox's Closed list; the customer isn't told) or reopen. Reopening puts it back
 * under "Needs you", since a person chose to pick it up again.
 */
export async function setStatus(ticketId: string, status: "CLOSED" | "OPEN") {
  await requireAgent();
  await db.supportTicket.update({ where: { id: ticketId }, data: status === "CLOSED" ? { status, urgent: false } : { status: "NEEDS_HUMAN" } });
  revalidatePath(`/support/${ticketId}`);
  revalidatePath("/support");
  redirect(`/support/${ticketId}?done=${status === "CLOSED" ? "closed" : "reopened"}`);
}

/** Permanently removes one conversation (for test chats and spam). The page asks first. */
export async function deleteTicket(ticketId: string) {
  await requireAgent();
  await db.supportTicket.deleteMany({ where: { id: ticketId } });
  revalidatePath("/support");
  redirect("/support?show=open");
}

/** Permanently removes every conversation (/support/clear). The form must carry confirm=DELETE. */
export async function deleteAllTickets(form: FormData) {
  await requireAgent();
  if (String(form.get("confirm") ?? "").trim() !== "DELETE") redirect("/support/clear?error=confirm");
  await db.supportTicket.deleteMany({});
  revalidatePath("/support");
  redirect("/support?cleared=1");
}
