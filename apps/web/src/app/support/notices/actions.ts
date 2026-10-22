"use server";

import { revalidatePath } from "next/cache";
import { currentSupportAdmin } from "@/lib/support/admin";
import { sendSubprocessorNotice, type NoticeResult } from "@/lib/support/subprocessorNotice";

/** Emails every business owner the new sub-processor notice (support admins only; checked again here, not just on the page). */
export async function sendNotice(input: { name: string; purpose: string; location: string; startsOn: string }): Promise<NoticeResult> {
  const admin = await currentSupportAdmin();
  if (!admin) return { ok: false, message: "Only a support admin can send this." };
  const result = await sendSubprocessorNotice(admin, input);
  if (result.ok) revalidatePath("/support/notices");
  return result;
}
