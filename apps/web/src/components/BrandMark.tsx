import Link from "next/link";
import Logo from "./Logo";
import type { Brand } from "@/lib/branding";

/** The business's own logo and name for client-facing pages, with a quiet SureFrame credit. */
export default function BrandMark({ brand, href }: { brand: Brand | null; href: string }) {
  if (!brand || (!brand.logoUrl && !brand.color)) return <Logo href={href} />;
  return (
    <Link href={href} className="flex min-w-0 items-center gap-2 font-semibold tracking-tight text-ink">
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" className="h-8 max-w-[8rem] shrink-0 object-contain" />
      ) : (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-sm text-on-primary">
          {brand.name.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <span className="truncate">{brand.name}</span>
      <span className="hidden shrink-0 text-xs font-normal text-dim sm:inline">via SureFrame</span>
    </Link>
  );
}
