import type { Metadata } from "next";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import BrandingForm, { BusinessNameForm } from "@/components/BrandingForm";
import { ClientContactForm, ClientEmailsForm } from "@/components/ClientEmailSettings";
import { brandOf } from "@/lib/branding";
import { PLANS } from "@/lib/plans";
import { requirePageUser } from "@/lib/session";

export const metadata: Metadata = { title: "Branding" };

export default async function BrandingSettings() {
  const { user, workspace, role } = await requirePageUser("/settings/branding");
  const brand = brandOf({ ...workspace, plan: "SOLO" });
  return (
    <>
      <AppHeader email={user.email} plan={PLANS[workspace.plan].name} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Branding</h1>
        <p className="mt-1 text-sm text-dim">
          Your business name, logo and colour on the pages and emails your clients see, how clients can reach you, and your client emails.
        </p>
        {role === "MEMBER" ? (
          <p className="mt-6 rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Ask an owner or admin of {workspace.name} to change the branding.</p>
        ) : workspace.plan === "FREE" ? (
          <>
            <BusinessNameForm name={workspace.name} />
            <div className="mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="branding-upgrade">
              <p className="font-semibold text-ink">Custom branding is part of every paid plan.</p>
              <p className="mt-1 text-sm text-muted">
                {workspace.name} is on the Free plan, so your clients see standard SureFrame pages and emails, with your business name.
                Upgrade to put your logo and colour on them.
                {(workspace.brandLogoType || workspace.brandColor) && " Your saved logo and colour are kept and come back when you upgrade."}
              </p>
              <Link href="/pricing" className="mt-4 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">See plans</Link>
            </div>
          </>
        ) : (
          <BrandingForm workspaceId={workspace.id} name={workspace.name} color={brand.color} logoUrl={brand.logoUrl} />
        )}
        {/* On every plan (not part of custom branding): how clients reach the business, and the emails they get (Decisions 5, 13). */}
        {role !== "MEMBER" && (
          <>
            <ClientContactForm business={workspace.name} email={workspace.contactEmail ?? ""} phone={workspace.contactPhone ?? ""} />
            <ClientEmailsForm replyTo={workspace.reminderReplyTo ?? ""} message={workspace.reminderMessage ?? ""} />
          </>
        )}
      </main>
    </>
  );
}
