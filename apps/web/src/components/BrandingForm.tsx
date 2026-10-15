"use client";

import { useCallback, useMemo, useState } from "react";
import { colorProblem, logoPath, type Brand } from "@/lib/branding";
import { prepareLogo } from "@/lib/logoFile";
import { FullPreview, PreviewStage, Segmented, VIEWS, type Device } from "./BrandPreview";
import type { PreviewView } from "./ClientPreview";

const SWATCHES = ["#3b55e6", "#0f766e", "#1f7a5c", "#b91c1c", "#c2410c", "#7c3aed", "#be185d", "#0f172a"];

export default function BrandingForm(props: { workspaceId: string; name: string; color: string | null; logoUrl: string | null }) {
  const [saved, setSaved] = useState({ name: props.name, color: props.color ?? "", logoUrl: props.logoUrl });
  const [name, setName] = useState(props.name);
  const [color, setColor] = useState(props.color ?? "");
  // A newly picked logo, ready to upload, and how it looks (a data: URL, shown before saving).
  const [file, setFile] = useState<{ file: File; dataUrl: string; resized: boolean } | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState<string>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [view, setView] = useState<PreviewView>("video");
  const [device, setDevice] = useState<Device>("desktop");
  const [full, setFull] = useState(false);

  const problem = color ? colorProblem(color) : null;
  const logo = removeLogo ? null : file ? file.dataUrl : saved.logoUrl;
  const trimmed = name.trim();
  const nameChanged = trimmed !== saved.name;
  const dirty = !!file || removeLogo || color !== saved.color || nameChanged;
  // New workspaces are named after the person's email ("sam's workspace").
  const placeholderName = /'s workspace$/i.test(trimmed);
  // The preview follows every change straight away, saved or not. A colour that
  // can't be saved shows the last one that can.
  const brand: Brand = useMemo(() => ({ name: trimmed || saved.name, logoUrl: logo, color: problem ? saved.color || null : color || null }), [trimmed, saved.name, logo, problem, color, saved.color]);

  async function pick(input: HTMLInputElement) {
    const f = input.files?.[0];
    // Let the same file be picked again after removing it.
    input.value = "";
    setMsg(undefined);
    setLogoMsg(undefined);
    if (!f) return;
    const ready = await prepareLogo(f);
    if ("error" in ready) return setLogoMsg(ready.error);
    setFile(ready);
    setRemoveLogo(false);
  }

  async function save() {
    setBusy(true);
    setMsg(undefined);
    if (nameChanged) {
      const r = await fetch("/api/workspace/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      }).catch(() => null);
      const d = r ? await r.json().catch(() => ({})) : {};
      if (!r?.ok) {
        setBusy(false);
        return setMsg({ ok: false, text: d.error ?? "Could not save the business name. Check your connection and try again." });
      }
      setSaved((v) => ({ ...v, name: d.name ?? trimmed }));
      setName(d.name ?? trimmed);
    }
    const fd = new FormData();
    fd.set("color", color);
    if (file) fd.set("logo", file.file);
    if (removeLogo) fd.set("removeLogo", "1");
    const res = await fetch("/api/workspace/branding", { method: "POST", body: fd }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setMsg({ ok: false, text: data.error ?? "Could not save. Check your connection and try again." });
    setSaved((v) => ({ ...v, color: data.color ?? "", logoUrl: data.hasLogo ? logoPath(props.workspaceId, data.version) : null }));
    setColor(data.color ?? "");
    setFile(null);
    setRemoveLogo(false);
    setMsg({ ok: true, text: "Saved. Your clients see this now." });
  }

  const closeFull = useCallback(() => setFull(false), []);

  return (
    <div className="mt-6 space-y-6 xl:grid xl:grid-cols-[minmax(0,1fr)_23.75rem] xl:items-start xl:gap-6 xl:space-y-0">
      <div className="grid gap-6 rounded-2xl border border-line bg-surface p-6 md:grid-cols-2 xl:order-2 xl:grid-cols-1">
        <label className="grid gap-1 md:col-span-2 xl:col-span-1">
          <span className="text-sm font-medium text-muted">Business name</span>
          <span className="text-xs text-dim">Shown next to your logo on client pages, and as the sender of your emails.</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            aria-label="Business name"
            placeholder="Your business name"
            className="mt-2 w-full max-w-md rounded-xl border border-line-strong px-3 py-2 text-sm"
          />
          {!trimmed && <span className="text-sm text-danger-fg">Enter your business name.</span>}
          {placeholderName && <span className="text-sm text-warn-fg" data-testid="name-hint">Clients see this name. Change it to your business name.</span>}
        </label>
        <div>
          <p className="text-sm font-medium text-muted">Logo</p>
          <p className="text-xs text-dim">PNG, JPG, WebP or SVG. A wide logo on a transparent background works best; large images are resized for you.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="grid h-14 w-40 place-items-center rounded-xl border border-dashed border-line-strong bg-canvas p-2">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="Your logo" data-testid="logo-thumb" className="max-h-10 max-w-full object-contain" />
              ) : (
                <span className="text-xs text-dim">No logo</span>
              )}
            </span>
            <label className="cursor-pointer rounded-xl border border-line-strong px-3 py-2 text-sm font-semibold text-ink hover:bg-hover focus-within:ring-2 focus-within:ring-primary">
              {logo ? "Replace logo" : "Upload logo"}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" className="sr-only" onChange={(e) => pick(e.currentTarget)} />
            </label>
            {logo && (
              <button type="button" onClick={() => { setFile(null); setRemoveLogo(true); setLogoMsg(undefined); }} className="text-sm text-muted hover:text-ink">
                Remove
              </button>
            )}
          </div>
          {logoMsg && <p role="alert" className="mt-2 text-sm text-danger-fg">{logoMsg}</p>}
          {file?.resized && <p className="mt-2 text-xs text-dim">Resized to fit. It stays sharp at the size clients see it.</p>}
        </div>
        <div>
          <p className="text-sm font-medium text-muted">Accent colour</p>
          <p className="text-xs text-dim">Used for buttons, links and your clients&apos; reply bubbles.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {SWATCHES.map((s) => (
              <button
                key={s}
                type="button"
                aria-label={`Use ${s}`}
                aria-pressed={color === s}
                onClick={() => setColor(s)}
                className={`h-8 w-8 rounded-full border border-line-strong ring-offset-2 ${color === s ? "ring-2 ring-ink ring-offset-surface" : ""}`}
                style={{ background: s }}
              />
            ))}
            <input
              type="color"
              aria-label="Custom colour"
              value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#3b55e6"}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-10 cursor-pointer rounded border border-line-strong"
            />
            <input
              aria-label="Colour code"
              value={color}
              placeholder="#3b55e6"
              onChange={(e) => setColor(e.target.value.trim().toLowerCase())}
              className="w-28 rounded-xl border border-line-strong px-3 py-1.5 text-sm"
            />
            {color && <button type="button" onClick={() => setColor("")} className="text-sm text-muted hover:text-ink">Default</button>}
          </div>
          {problem && <p className="mt-2 text-sm text-danger-fg">{problem}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5 md:col-span-2 xl:col-span-1">
          <button
            onClick={save}
            disabled={busy || !!problem || !dirty || !trimmed}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save branding"}
          </button>
          {msg ? (
            <p role="status" className={`text-sm ${msg.ok ? "text-ok-fg" : "text-danger-fg"}`}>{msg.text}</p>
          ) : dirty ? (
            <p className="text-sm text-warn-fg" data-testid="unsaved">Not saved yet. The preview shows your changes; clients still see the saved version.</p>
          ) : null}
        </div>
      </div>

      <section aria-labelledby="preview-title" className="xl:order-1">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full">
            <h2 id="preview-title" className="text-lg font-semibold text-ink">What your clients see</h2>
            <p className="text-sm text-dim">A live preview with sample content. It updates as you change your logo and colour.</p>
          </div>
          <Segmented label="Page" value={view} options={VIEWS} onChange={setView} />
          <Segmented label="Screen size" value={device} options={[{ id: "desktop", label: "Desktop" }, { id: "phone", label: "Phone" }]} onChange={setDevice} />
          <button type="button" onClick={() => setFull(true)} className="ml-auto rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-hover">
            Open full preview
          </button>
        </div>
        <div className={`mt-4 rounded-2xl p-4 sm:p-6 ${device === "phone" ? "bg-line-strong/70" : "bg-surface-2"}`}>
          <PreviewStage brand={brand} view={view} device={device} testId="brand-preview" />
        </div>
        <p className="mt-2 text-xs text-dim">The small &ldquo;Made with SureFrame&rdquo; credit always stays at the bottom of client pages.</p>
      </section>

      {full && <FullPreview brand={brand} view={view} device={device} onView={setView} onDevice={setDevice} onClose={closeFull} />}
    </div>
  );
}
