"use client";

import { useEffect, useMemo, useState } from "react";
import { browserTimeZone } from "@/lib/schedule";

/** "GMT+10" for a zone right now, or "" where the browser can't say. */
function offsetOf(zone: string, at: Date) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

const plain = (zone: string) => zone.replace(/_/g, " ").replace(/\//g, " / ");

/**
 * Settings > Reminders: the business's time zone. The full list has about 400
 * "Area/City" names, so it can be searched ("Brisbane", "GMT+10"), and one
 * button picks the zone this device is set to.
 */
export default function TimeZonePicker({ value, onChange, className }: { value: string; onChange: (zone: string) => void; className: string }) {
  const [zones, setZones] = useState<string[]>([]);
  const [device, setDevice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    try {
      setZones((Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"));
    } catch {
      setZones([]);
    }
    setDevice(browserTimeZone());
  }, []);
  const labelled = useMemo(() => {
    const now = new Date();
    return (zones.includes(value) ? zones : [value, ...zones]).map((z) => {
      const offset = offsetOf(z, now);
      return { zone: z, label: offset ? `${plain(z)} (${offset})` : plain(z) };
    });
  }, [zones, value]);
  const q = query.trim().toLowerCase();
  const matches = q ? labelled.filter((z) => z.label.toLowerCase().includes(q) || z.zone.toLowerCase().includes(q.replace(/\s+/g, "_"))) : labelled;
  // The chosen zone stays in the list, so the box never shows something that isn't picked.
  const shown = matches.some((z) => z.zone === value) ? matches : [...labelled.filter((z) => z.zone === value), ...matches];

  return (
    <div className="grid gap-2">
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          // One match: pick it, so typing a city is enough.
          const next = e.target.value.trim().toLowerCase();
          const found = next ? labelled.filter((z) => z.label.toLowerCase().includes(next) || z.zone.toLowerCase().includes(next.replace(/\s+/g, "_"))) : [];
          if (found.length === 1) onChange(found[0].zone);
        }}
        placeholder="Search, e.g. Brisbane"
        aria-label="Search time zones"
        className={className}
        data-testid="tz-search"
      />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Time zone" className={className}>
        {shown.map((z) => (
          <option key={z.zone} value={z.zone}>
            {z.label}
          </option>
        ))}
      </select>
      {q && matches.length === 0 && <span className="text-xs text-warn-fg">No time zone matches &ldquo;{query.trim()}&rdquo;. Try a nearby big city.</span>}
      {device && device !== value ? (
        <button type="button" onClick={() => onChange(device)} className="justify-self-start text-sm font-medium text-accent hover:underline" data-testid="tz-device">
          Use my device&apos;s time zone ({plain(device)})
        </button>
      ) : (
        device && <span className="text-xs text-dim" data-testid="tz-is-device">This is the time zone your device is set to.</span>
      )}
    </div>
  );
}
