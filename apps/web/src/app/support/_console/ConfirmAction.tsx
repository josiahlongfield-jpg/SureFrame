"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { DialogButtons, DialogShell, primaryButton } from "@/components/ConfirmDialog";

function Submit({ label, danger }: { label: string; danger: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className={danger ? "rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60" : primaryButton}
    >
      {pending ? "Working…" : label}
    </button>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab go round the dialog's own buttons, not out to the page behind it. */
function trap(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "Tab") return;
  const els = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (!els.length) return;
  const first = els[0];
  const last = els[els.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * A support button that asks first, in the page (not the browser's own pop-up), then runs a server action. Like the
 * Billing dialogs, focus moves into it and Escape closes it; the keyboard stays inside while it's open, and closing it
 * puts focus back on the button that opened it (P61).
 */
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
  const opener = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => opener.current?.focus());
  };
  return (
    <>
      <button ref={opener} type="button" onClick={() => setOpen(true)} className={className} data-testid={testId}>
        {label}
      </button>
      {open && (
        <div onKeyDown={trap}>
          <DialogShell title={title} onClose={close} role="alertdialog" testId={testId && `${testId}-dialog`}>
            <div className="mt-2 text-sm text-muted">{children}</div>
            <form action={action}>
              <DialogButtons>
                <Submit label={confirm} danger={danger} />
                <button
                  type="button"
                  onClick={close}
                  className="rounded-xl border border-line-strong px-4 py-2.5 text-sm font-semibold text-ink hover:bg-hover"
                >
                  Cancel
                </button>
              </DialogButtons>
            </form>
          </DialogShell>
        </div>
      )}
    </>
  );
}
