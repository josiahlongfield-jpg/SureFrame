"use client";

import { useEffect, useRef, useState } from "react";
import type { PreviewView } from "./ClientPreview";
import type { Brand } from "@/lib/branding";

export type Device = "desktop" | "phone";

/**
 * Real viewport sizes, so the client pages lay out exactly as they do for
 * clients. Desktop is a small laptop's width (still the desktop layout), so the
 * scaled-down preview stays big enough to read.
 */
const SIZES: Record<Device, { w: number; h: number }> = {
  desktop: { w: 1024, h: 720 },
  phone: { w: 390, h: 844 },
};
const BEZEL = 10;

export const VIEWS: { id: PreviewView; label: string }[] = [
  { id: "video", label: "Video page" },
  { id: "inbox", label: "Inbox" },
  { id: "email", label: "Email" },
];

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-surface-2 p-1 text-sm">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3 py-1.5 font-medium ${value === o.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The client pages (settings/branding/preview) in a frame at a real phone or
 * desktop width, scaled to fit. `fit="contain"` also fits the height, for the
 * full-screen view.
 */
export function PreviewStage({ brand, view, device, fit = "width", testId }: { brand: Brand; view: PreviewView; device: Device; fit?: "width" | "contain"; testId?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  // The frame loads once; later view changes are sent to it, so switching is instant.
  const [src] = useState(`/settings/branding/preview?view=${view}`);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === location.origin && e.source === frame.current?.contentWindow && e.data?.type === "brand-preview-ready") setReady(true);
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ type: "brand-preview", brand, view }, location.origin);
  }, [ready, brand, view]);

  const size = SIZES[device];
  const pad = device === "phone" ? BEZEL * 2 : 0;
  const scale = room.w
    ? Math.min(1, (room.w - pad) / size.w, fit === "contain" && room.h ? (room.h - pad) / size.h : 1)
    : 0;
  return (
    <div ref={box} className={fit === "contain" ? "h-full w-full" : "w-full"}>
      <div className="mx-auto" style={{ width: size.w * scale + pad, height: size.h * scale + pad, visibility: scale ? "visible" : "hidden" }}>
        <div
          className={device === "phone" ? "h-full w-full overflow-hidden rounded-[2.25rem] bg-solid shadow-xl" : "h-full w-full overflow-hidden rounded-xl border border-line-strong bg-surface shadow-sm"}
          style={device === "phone" ? { padding: BEZEL } : undefined}
        >
          <div className={device === "phone" ? "h-full w-full overflow-hidden rounded-[1.6rem] bg-surface" : "h-full w-full overflow-hidden"}>
            <iframe
              ref={frame}
              src={src}
              title="Preview of what your clients see"
              data-testid={testId}
              data-ready={ready || undefined}
              style={{ width: size.w, height: size.h, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0, display: "block" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Full-screen version of the same preview. */
export function FullPreview({ brand, view, device, onView, onDevice, onClose }: { brand: Brand; view: PreviewView; device: Device; onView: (v: PreviewView) => void; onDevice: (d: Device) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Full preview of what your clients see" data-testid="full-preview" className="fixed inset-0 z-50 flex flex-col bg-canvas">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <p className="mr-auto text-sm font-semibold text-ink">What your clients see</p>
        <Segmented label="Page" value={view} options={VIEWS} onChange={onView} />
        <Segmented label="Screen size" value={device} options={[{ id: "desktop", label: "Desktop" }, { id: "phone", label: "Phone" }]} onChange={onDevice} />
        <button type="button" onClick={onClose} autoFocus className="rounded-lg bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-hover">
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 p-4 sm:p-6">
        <PreviewStage brand={brand} view={view} device={device} fit="contain" testId="full-preview-frame" />
      </div>
    </div>
  );
}
