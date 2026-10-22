"use client";

import { useState } from "react";
import ConfirmDialog, { primaryButton } from "@/components/ConfirmDialog";
import { sendNotice } from "./actions";

const field = "w-full rounded-xl border border-line-strong px-3 py-2 text-sm";

/**
 * The new sub-processor notice: name, what it does, where, and the start date (at least `days` days away, which the
 * server checks too). Send asks first, saying how many business owners it emails.
 */
export default function NoticeForm({ owners, earliest, days }: { owners: number; earliest: string; days: number }) {
  const [form, setForm] = useState({ name: "", purpose: "", location: "", startsOn: earliest });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const people = `${owners} business owner${owners === 1 ? "" : "s"}`;

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await sendNotice(form);
      if (r.ok) {
        setAsking(false);
        setDone(`Sent to ${r.sent} of ${r.recipients} business owner${r.recipients === 1 ? "" : "s"}. It's in the Support log.`);
        setForm({ name: "", purpose: "", location: "", startsOn: earliest });
      } else setError(r.message);
    } catch {
      setError("Couldn't send the notice. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-6 grid gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-6"
      data-testid="notice-form"
      onSubmit={(e) => {
        e.preventDefault();
        setDone(undefined);
        setError(undefined);
        // The date box won't go earlier than `earliest`; the server checks it again, and says so in the dialog.
        setAsking(true);
      }}
    >
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-ink">Sub-processor&rsquo;s name</span>
        <input required maxLength={80} value={form.name} onChange={set("name")} placeholder="Provider A" className={field} data-testid="notice-name" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-ink">What it does for us</span>
        <input required maxLength={240} value={form.purpose} onChange={set("purpose")} placeholder="Sending our emails" className={field} data-testid="notice-purpose" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-ink">Where it processes information</span>
        <input required maxLength={120} value={form.location} onChange={set("location")} placeholder="United States" className={field} data-testid="notice-location" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-ink">Starts on</span>
        <input required type="date" min={earliest} value={form.startsOn} onChange={set("startsOn")} className={`${field} sm:w-auto`} data-testid="notice-start" />
        <span className="text-xs text-dim">At least {days} days from today (Queensland), as the DPA promises.</span>
      </label>
      {error && !asking && (
        <p role="alert" className="rounded-xl border border-danger-line bg-danger-bg p-3 text-sm text-danger-fg" data-testid="notice-error">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-xl border border-ok-line bg-ok-bg p-3 text-sm text-ok-fg" data-testid="notice-done">
          {done}
        </p>
      )}
      <div>
        <button className={primaryButton} disabled={!owners} data-testid="notice-send">
          Email every business owner…
        </button>
      </div>
      {asking && (
        <ConfirmDialog
          title={`Email ${people}?`}
          body={
            <>
              <p>
                Every business owner on SureFrame gets the notice about <strong className="text-ink">{form.name}</strong>, starting{" "}
                {new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${form.startsOn}T00:00:00Z`))}.
              </p>
              <p>This can&rsquo;t be undone, and it can only be sent once for this sub-processor and date.</p>
            </>
          }
          confirmLabel={`Send to ${people}`}
          cancelLabel="Cancel"
          busy={busy}
          error={error}
          onConfirm={send}
          onCancel={() => setAsking(false)}
          testId="notice-confirm"
        />
      )}
    </form>
  );
}
