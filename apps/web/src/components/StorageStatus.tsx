"use client";

import { useEffect, useState } from "react";

const relative = (ms: number) => {
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  const h = ms / 3_600_000;
  if (h < 1) return rtf.format(Math.max(1, Math.round(ms / 60_000)), "minute");
  if (h < 48) return rtf.format(Math.round(h), "hour");
  return rtf.format(Math.round(h / 24), "day");
};

/**
 * Where a recording's encrypted server copy stands, in the viewer's own time
 * zone (rendered after mount so the server's time zone never shows).
 */
export default function StorageStatus({ status, purgeAt, cloudBackup }: { status: string; purgeAt: string | null; cloudBackup: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (status === "RECORDING") return null;
  const base = "mt-1 flex items-center gap-1.5 text-xs";
  if (status === "EXPIRED") return <p data-testid="storage-status" className={`${base} text-dim`}>Deleted from our servers</p>;
  if (!purgeAt) {
    return (
      <p data-testid="storage-status" className={`${base} text-ok-fg`}>
        {cloudBackup ? "Saved to cloud backup" : "Kept on our servers"}
      </p>
    );
  }
  if (now === null) return <p data-testid="storage-status" className={`${base} text-dim`}>&nbsp;</p>;
  const at = new Date(purgeAt);
  const left = at.getTime() - now;
  const soon = left < 48 * 3_600_000;
  const when = at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  return (
    <p data-testid="storage-status" data-soon={soon ? "true" : undefined} className={`${base} ${soon ? "font-medium text-warn-fg" : "text-dim"}`} title="Save it to your device to keep a copy">
      {left <= 0 ? (
        <>Deleting from our servers now (was due {when})</>
      ) : (
        <>
          Deletes from our servers on {when} · {relative(left)}
        </>
      )}
    </p>
  );
}
