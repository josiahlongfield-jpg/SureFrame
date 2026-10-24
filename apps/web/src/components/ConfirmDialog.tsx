"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * The in-page dialog box billing uses instead of the browser's own confirm():
 * dimmed page, a card in the middle, Escape or the background closes it.
 * Buttons don't wrap mid-word, and stack on a phone.
 */
export function DialogShell({
  title,
  onClose,
  children,
  role = "dialog",
  testId,
}: {
  title: ReactNode;
  /** Escape and a click on the dimmed background call this; leave it out while something is in progress. */
  onClose?: () => void;
  children: ReactNode;
  role?: "dialog" | "alertdialog";
  testId?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus the first button, so the keyboard starts inside the dialog.
    box.current?.querySelector<HTMLElement>("button, a[href], input, select")?.focus();
  }, []);
  useEffect(() => {
    if (!onClose) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div
      role={role}
      aria-modal="true"
      aria-labelledby={id}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-solid/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
      data-testid={testId}
    >
      {/* my-auto centres it, and a tall one scrolls from its top instead of being cut off. */}
      <div ref={box} className="my-auto w-full max-w-md rounded-2xl bg-surface p-6 text-left shadow-xl">
        <h2 id={id} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/** A row of dialog buttons: the main one last in the markup is shown first on a phone and on the right on a computer. */
export function DialogButtons({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse sm:flex-wrap [&>*]:whitespace-nowrap">{children}</div>;
}

export const primaryButton = "rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60";
export const dangerButton = "rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60";
export const secondaryButton = "rounded-xl border border-line-strong px-4 py-2.5 text-center text-sm font-medium text-ink hover:bg-hover disabled:opacity-60";
export const quietButton = "rounded-xl px-4 py-2.5 text-sm font-medium text-muted hover:text-ink disabled:opacity-60";

/** Asks before a billing change (adding or removing an add-on or seats), with what it costs and when. */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Not now",
  busy = false,
  error,
  danger = false,
  onConfirm,
  onCancel,
  testId = "confirm-dialog",
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}) {
  return (
    <DialogShell title={title} onClose={busy ? undefined : onCancel} testId={testId}>
      <div className="mt-3 space-y-2 text-sm text-muted">{body}</div>
      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg">
          {error}
        </p>
      )}
      <DialogButtons>
        <button onClick={onConfirm} disabled={busy} className={danger ? dangerButton : primaryButton} data-testid={`${testId}-yes`}>
          {busy ? "One moment…" : confirmLabel}
        </button>
        <button onClick={onCancel} disabled={busy} className={quietButton}>
          {cancelLabel}
        </button>
      </DialogButtons>
    </DialogShell>
  );
}
