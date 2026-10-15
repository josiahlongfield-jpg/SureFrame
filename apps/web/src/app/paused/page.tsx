import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import Link from "next/link";
import Logo from "@/components/Logo";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Access paused", robots: { index: false } };

/** Where staff land when their team's plan no longer covers their login (lib/seatLimits.ts). */
export default async function Paused() {
  const me = await currentUser();
  if (!me) redirect("/login");
  if (!me.paused) redirect("/library");
  const others = me.user.memberships.filter((m) => !m.pausedAt && m.workspaceId !== me.workspace.id);

  async function switchTo(form: FormData) {
    "use server";
    const now = await currentUser();
    if (!now) redirect("/login");
    const id = String(form.get("workspaceId") ?? "");
    if (now.user.memberships.some((m) => m.workspaceId === id && !m.pausedAt)) {
      await db.user.update({ where: { id: now.user.id }, data: { activeWorkspaceId: id } });
    }
    redirect("/library");
  }

  return (
    <main data-theme="fresh" className="text-ink mx-auto max-w-md px-4 py-16 sm:px-6">
      <Logo tone="dark" />
      <h1 className="mt-10 text-2xl font-semibold tracking-tight text-ink">Your access is paused</h1>
      <p className="mt-3 text-muted" data-testid="paused-message">
        {me.workspace.name}&apos;s SureFrame plan changed and no longer covers your staff login. The pause doesn&apos;t delete anything. Ask the owner to restore your access.
      </p>
      {others.length > 0 && (
        <div className="mt-6 grid gap-2">
          {others.map((m) => (
            <form key={m.workspaceId} action={switchTo}>
              <input type="hidden" name="workspaceId" value={m.workspaceId} />
              <button className="w-full rounded-xl border border-line-strong px-4 py-3 text-left font-medium text-ink hover:bg-hover">
                Go to {m.workspace.name}
              </button>
            </form>
          ))}
        </div>
      )}
      <p className="mt-6 text-sm text-muted">
        You can still <Link href="/settings/account" className="font-medium text-accent hover:underline">download your data or delete your account</Link>.
      </p>
      <form
        className="mt-6"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button className="rounded-xl bg-primary px-4 py-2.5 font-semibold text-on-primary hover:bg-primary-hover">Sign out</button>
      </form>
    </main>
  );
}
