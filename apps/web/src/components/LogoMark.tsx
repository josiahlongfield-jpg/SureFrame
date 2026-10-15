/**
 * The SureFrame mark: viewfinder corners (the frame) around a padlock (private).
 * "light" is for light backgrounds, "dark" for dark ones, "mono" takes the text colour.
 */
export default function LogoMark({ size = 32, tone = "light", className }: { size?: number; tone?: "light" | "dark" | "mono"; className?: string }) {
  const frame = tone === "dark" ? "#ffffff" : tone === "mono" ? "currentColor" : "#3b55e6";
  const lock = tone === "dark" ? "#ff7a6e" : tone === "mono" ? "currentColor" : "#ff5d4f";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <g fill="none" stroke={frame} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 22V13a6 6 0 0 1 6-6h9M42 7h9a6 6 0 0 1 6 6v9M57 42v9a6 6 0 0 1-6 6h-9M22 57h-9a6 6 0 0 1-6-6v-9" />
      </g>
      <path d="M26 30v-4.5a6 6 0 0 1 12 0V30" fill="none" stroke={lock} strokeWidth="4" strokeLinecap="round" />
      <rect x="21" y="29" width="22" height="17" rx="4.5" fill={lock} />
    </svg>
  );
}

/** The name with a bold "Sure" and an extra-light "Frame". */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`tracking-[-0.02em] ${className}`}>
      <span className="font-bold">Sure</span>
      <span className="font-extralight">Frame</span>
    </span>
  );
}
