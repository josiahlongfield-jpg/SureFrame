/** Shown to clients of a business that uses the AI summaries add-on. */
export default function AiNotice({ className = "" }: { className?: string }) {
  return (
    <p className={`flex items-start gap-2 px-1 text-xs text-dim ${className}`} data-testid="ai-notice">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8h.01M11 12h1v4h1" />
      </svg>
      <span>
        This business uses AI summaries. Transcripts are made on their device, and the transcript text is summarised by AI (Anthropic&apos;s Claude). Your replies
        aren&apos;t included. Summaries can contain mistakes.
      </span>
    </p>
  );
}
