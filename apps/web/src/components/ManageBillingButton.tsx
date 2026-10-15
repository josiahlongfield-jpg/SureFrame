"use client";

export default function ManageBillingButton() {
  async function go() {
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (data.url) window.location.href = data.url;
    else alert(data.error ?? "Could not open billing portal");
  }
  return (
    <button onClick={go} className="rounded-xl border border-line-strong px-4 py-2 text-sm font-medium hover:bg-hover">
      Manage subscription
    </button>
  );
}
