import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import BackToContents from "@/components/BackToContents";
import { LEGAL, LEGAL_VERSIONS, SUBPROCESSORS, WORDING_UPDATES } from "@/lib/legal";

/** Our service providers, as one list for the privacy policy and the DPA (`customerData` for the DPA's Annex 3). */
export function SubprocessorList({ customerData = false }: { customerData?: boolean }) {
  return (
    <ul>
      {SUBPROCESSORS.filter((s) => !customerData || s.customerData).map((s) => (
        <li key={s.name}>
          <strong>{s.name}</strong> ({s.purpose}): {s.data}.{s.location && ` Location: ${s.location}.`}
        </li>
      ))}
    </ul>
  );
}

/** The words in a heading, however it was written in JSX. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * The page's sections (its h2 headings) as a table of contents, and the page with an id on each heading so the
 * contents can link to it. A heading that already has an id (linked from elsewhere) keeps it.
 */
function withContents(children: ReactNode) {
  const toc: { id: string; text: string }[] = [];
  const body = Children.map(children, (child) => {
    if (!isValidElement<{ id?: string; children?: ReactNode }>(child) || child.type !== "h2") return child;
    const text = textOf(child.props.children);
    const id = child.props.id ?? slug(text);
    toc.push({ id, text });
    return child.props.id ? child : cloneElement(child as ReactElement<{ id?: string }>, { id });
  });
  return { toc, body };
}

/**
 * Shared layout for the terms, privacy policy and data processing agreement.
 * Headings get a scroll margin so links to their ids clear the sticky header.
 * Long pages open with their contents. A versioned page says which version it is, when that version took effect
 * (as /legal/archive lists it) and when its wording was last updated, with what changed on that date (V43) from
 * WORDING_UPDATES when `doc` is given.
 */
export default function LegalPage({
  title,
  version,
  updated = LEGAL.updated,
  doc,
  children,
}: {
  title: string;
  version?: string;
  updated?: string;
  doc?: "terms" | "privacy" | "dpa";
  children: ReactNode;
}) {
  const { toc, body } = withContents(children);
  // What changed on the last-updated date: a wording update, or a new version people agree to (LEGAL_VERSIONS).
  const wording = doc ? WORDING_UPDATES.find((u) => u.date === updated)?.[doc] : undefined;
  const release = doc && !wording ? LEGAL_VERSIONS.find((v) => v.date === updated) : undefined;
  const latest = wording ?? (release && (doc === "dpa" ? ("dpa" in release ? release.dpa : undefined) : release.changes));
  const since = version ? (LEGAL_VERSIONS.find((v) => v.terms === version || v.privacy === version)?.date ?? (version === LEGAL.dpaVersion ? LEGAL.dpaSince : undefined)) : undefined;
  return (
    <div data-theme="fresh" className="min-h-screen bg-canvas text-ink">
      <SiteHeader navy />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm text-dim" data-testid="legal-version">
          {version && (
            <>
              Version {version}
              {since && ` (in effect from ${since})`} ·{" "}
            </>
          )}
          Last updated {updated}
          {/* The same line on all three documents (V29): version, when it took effect, last updated, all versions. */}
          {version && (
            <>
              {" "}
              · <Link href="/legal/archive" className="underline hover:text-ink">Versions and changes</Link>
            </>
          )}
        </p>
        {latest && latest.length > 0 && (
          <details className="group mt-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted" data-testid="legal-latest">
            <summary className="cursor-pointer font-semibold text-ink">What changed on {updated}</summary>
            <ul className="mt-1.5 space-y-1">
              {latest.map((c) => (
                <li key={c} className="ml-5 list-disc">
                  {c}
                </li>
              ))}
            </ul>
            {wording ? (
              <p className="mt-1.5">
                These clarify what we already do or add to what you get, so there&rsquo;s nothing new to agree to.{" "}
                <Link href="/legal/archive#wording-updates" className="text-accent underline">
                  Earlier changes
                </Link>
              </p>
            ) : (
              <p className="mt-1.5">
                This is a new version, so account holders are asked to agree to it.{" "}
                <Link href="/legal/archive#versions" className="text-accent underline">
                  Earlier versions
                </Link>
              </p>
            )}
          </details>
        )}
        {toc.length >= 4 && (
          <nav id="contents" aria-label="Contents" className="mt-8 scroll-mt-20 rounded-2xl border border-line bg-surface p-5 text-sm" data-testid="legal-toc">
            <p className="font-semibold text-ink">Contents</p>
            <ol className="mt-3 space-y-1.5 sm:columns-2 sm:gap-8">
              {toc.map((t) => (
                <li key={t.id} className="break-inside-avoid">
                  <a href={`#${t.id}`} className="text-accent hover:underline">
                    {t.text}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="legal mt-8 space-y-4 text-[0.9375rem] leading-7 text-muted [&_h2]:mt-10 [&_h2]:scroll-mt-20 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink [&_h3]:mt-6 [&_h3]:scroll-mt-20 [&_h3]:font-semibold [&_h3]:text-ink [&_a]:text-accent [&_a]:underline [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1 [&_li>ul]:mt-1">
          {body}
        </div>
        {toc.length >= 4 && <BackToContents />}
      </main>
      <SiteFooter />
    </div>
  );
}
