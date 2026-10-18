"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { DialogButtons, DialogShell, primaryButton } from "@/components/ConfirmDialog";

function Submit({ label, danger }: { label: string; danger: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className={danger ? "rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60" : primaryButton}>
      {pending ? "Working…" : label}
    </button>
  );
}

/** A support button that asks first, in the page (not the browser's own pop-up), then runs a server action. */
export default function ConfirmAction({
  action,
  label,
  title,
  children,
  confirm,
  danger = false,
  className,
  testId,
}: {
  action: () => Promise<void>;
  label: string;
  title: string;
  children: ReactNode;
  confirm: string;
  danger?: boolean;
  className: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} data-testid={testId}>
        {label}
      </button>
      {open && (
        <DialogShell title={title} onClose={() => setOpen(false)} role="alertdialog" testId={testId && `${testId}-dialog`}>
          <div className="mt-2 text-sm text-muted">{children}</div>
          <form action={action}>
            <DialogButtons>
              <Submit label={confirm} danger={danger} />
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink hover:bg-hover">
                Cancel
              </button>
            </DialogButtons>
          </form>
        </DialogShell>
      )}
    </>
  );
}
