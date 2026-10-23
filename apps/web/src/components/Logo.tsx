import Link from "next/link";
import { BRAND } from "@/lib/brand";
import LogoMark, { Wordmark } from "./LogoMark";

/** `tone="dark"` is for SureFrame's navy pages. */
export default function Logo({ href = "/", tone = "light" }: { href?: string; tone?: "light" | "dark" }) {
  return (
    <Link href={href} aria-label={BRAND.name} className={`flex items-center gap-2 text-lg ${tone === "dark" ? "text-ink" : "text-ink"}`}>
      <LogoMark size={tone === "dark" ? 26 : 30} tone={tone} />
      {/* The smallest phones get a slightly smaller name, so the top bar fits. */}
      <Wordmark className={tone === "dark" ? "text-lg min-[22.5rem]:text-xl" : ""} />
    </Link>
  );
}
