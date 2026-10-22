"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ClientPreview, { type PreviewView } from "./ClientPreview";
import type { Brand } from "@/lib/branding";

const VIEWS: { key: PreviewView; label: string }[] = [
  { key: "video", label: "A video" },
  { key: "inbox", label: "All their videos" },
  { key: "email", label: "The email" },
];

/** Sample business: nothing here is a real client, business or video. */
const BRAND: Brand = { name: "Business A", logoUrl: null, color: null };

/**
 * What a client sees, for visitors (V11): the same pages the Branding settings preview, with sample content, under a
 * bar that says it's an example and switches between the video page, the client's list of videos and the email.
 */
export default function ExampleClientPages({ initial }: { initial: PreviewView }) {
  const [view, setView] = useState(initial);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(location.origin), []);
  return (
    <>
      <div data-theme="navy" className="bg-canvas text-ink" data-testid="example-bar">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm sm:px-6">
          <p className="min-w-0">
            <span className="font-semibold">An example of what your client sees.</span>{" "}
            <span className="text-muted">Sample content: no account needed to watch or reply.</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Show" className="flex flex-wrap gap-1 rounded-lg bg-surface p-1">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  role="radio"
                  aria-checked={view === v.key}
                  onClick={() => setView(v.key)}
                  className={`rounded-md px-2.5 py-1 font-medium ${view === v.key ? "bg-primary text-on-primary" : "text-muted hover:text-ink"}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <Link href="/" className="font-medium text-accent hover:underline">Back to SureFrame</Link>
          </div>
        </div>
      </div>
      {/* A picture of the pages, not the pages: links and buttons in it do nothing. */}
      <div onClickCapture={(e) => e.preventDefault()} data-testid="example-pages">
        <ClientPreview brand={BRAND} view={view} sender="Owner A" origin={origin} />
      </div>
    </>
  );
}
