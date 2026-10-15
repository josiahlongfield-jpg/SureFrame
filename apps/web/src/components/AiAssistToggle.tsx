"use client";

import { useState } from "react";

type Props = {
  enabled: boolean;
  /** On a paid plan (or given free), so it can be switched on. */
  canEnable: boolean;
  /** Price for this workspace's plan, e.g. "US$8 per month on Solo"; null when given free. */
  priceLabel: string | null;
  usage: { used: number; limit: number } | null;
  /** The speech model is installed on the server, so transcripts can be made. */
  modelReady: boolean;
};

/** Settings > Billing: the AI transcripts and summaries add-on, with exactly what leaves the device. */
export default function AiAssistToggle({ enabled, canEnable, priceLabel, usage, modelReady }: Props) {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function toggle() {
    if (!on && priceLabel && !confirm(`Add AI transcripts and summaries for ${priceLabel}, plus any tax? You're charged today for the rest of this billing period, then it renews with your plan.`)) return;
    setBusy(true);
    setError(undefined);
    const res = await fetch("/api/billing/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !on }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (data.url) return void (window.location.href = data.url);
    if (!res.ok) return setError(data.error ?? "Could not change AI summaries");
    setOn(data.aiAssist);
  }

  return (
    <div className="mt-6 rounded-2xl border border-line bg-surface p-6" data-testid="ai-assist">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-ink">AI transcripts and summaries</p>
          <p className="mt-1 text-sm text-muted">
            Press a button under any video to get a transcript and a short summary with key points and action items, shown to your team and the client it was sent to.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            <li>• The transcript is made on your own device. The audio isn&apos;t sent anywhere to make it.</li>
            <li>• The transcript text is sent to Anthropic&apos;s Claude to write the summary. Anthropic doesn&apos;t train its models on it, and we don&apos;t keep a readable copy.</li>
            <li>• The transcript and summary are then end-to-end encrypted like your replies and notes.</li>
            <li>• Your clients see a short note that you use AI summaries. Let them know, and get their consent where your local rules require it.</li>
            <li>• Automatic transcripts and AI summaries can contain mistakes.</li>
          </ul>
          <p className="mt-3 text-xs text-dim">
            {!canEnable && !on ? "Available with a paid subscription (not on Free)." : priceLabel ? `${priceLabel}, plus any tax. Optional.` : "Included free with your plan."}
            {usage && ` ${usage.used} of ${usage.limit} summaries used this month.`}
          </p>
          {!modelReady && (on || canEnable) && (
            <p className="mt-2 text-xs text-warn-fg" data-testid="ai-model-missing">
              The speech model isn&apos;t installed yet, so new transcripts can&apos;t be made for now. We&apos;re setting it up
              {!on && priceLabel ? ", and you can add this once it&apos;s ready" : ""}.
            </p>
          )}
        </div>
        <button
          role="switch"
          aria-checked={on}
          aria-label="AI transcripts and summaries"
          onClick={toggle}
          disabled={busy || (!on && (!canEnable || (!modelReady && !!priceLabel)))}
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "bg-primary" : "bg-line-strong"}`}
        >
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-surface shadow transition ${on ? "left-6" : "left-1"}`} />
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p>}
    </div>
  );
}
