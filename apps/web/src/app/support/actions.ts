"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { activeSupportAgent, logAdmin } from "@/lib/support/admin";
import { staffReply } from "@/lib/support/tickets";

async function requireAgent() {
  const agent = await activeSupportAgent();
  if (!agent) redirect("/library");
  return { userId: agent.id, email: agent.email };
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

/**
 * Permanently removes one conversation (for test chats and spam). The page asks first. Recorded in the support log
 * (who, whose and when, never what was said), the only trace once it's gone (P13).
 */
export async function deleteTicket(ticketId: string) {
  const agent = await requireAgent();
  const ticket = await db.supportTicket.findUnique({ where: { id: ticketId }, include: { user: { select: { email: true } }, _count: { select: { messages: true } } } });
  if (ticket) {
    await db.$transaction(async (tx) => {
      await tx.supportTicket.delete({ where: { id: ticketId } });
      await logAdmin(tx, agent, {
        action: "support.delete",
        userId: ticket.userId,
        workspaceId: ticket.workspaceId,
        target: ticket.user?.email ?? ticket.email ?? "Website visitor",
        details: { ticketId, status: ticket.status, messages: ticket._count.messages },
      });
    });
  }
  revalidatePath("/support");
  redirect("/support?show=open");
}

/** Permanently removes every conversation (/support/clear). The form must carry confirm=DELETE. */
export async function deleteAllTickets(form: FormData) {
  const agent = await requireAgent();
  if (String(form.get("confirm") ?? "").trim() !== "DELETE") redirect("/support/clear?error=confirm");
  await db.$transaction(async (tx) => {
    // The ids, so an old conversation's address can say it was deleted (app/support/[id]); never what was said.
    const ids = (await tx.supportTicket.findMany({ select: { id: true }, take: 5000 })).map((t) => t.id);
    const { count } = await tx.supportTicket.deleteMany({});
    await logAdmin(tx, agent, { action: "support.delete_all", target: `${count} conversation${count === 1 ? "" : "s"}`, details: { count, ticketIds: ids } });
  });
  revalidatePath("/support");
  redirect("/support?cleared=1");
}
