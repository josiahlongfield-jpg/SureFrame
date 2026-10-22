import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { LEGAL, LEGAL_VERSIONS, WORDING_UPDATES } from "@/lib/legal";

export const metadata = { title: "Versions and changes" };

const DOC_NAMES = { terms: "Terms of Service", privacy: "Privacy Policy", dpa: "Data Processing Agreement" } as const;

/** The latest of the documents' "last updated" dates, for this page's own date (L8, V44). */
const latestUpdate = () => WORDING_UPDATES[0]?.date ?? LEGAL.updated;

/**
 * Every version of the Terms of Service and Privacy Policy people have agreed to (LEGAL_VERSIONS in lib/legal.ts), and the
 * wording updates since that kept the same version (WORDING_UPDATES), so a reader can check what changed on each date (L1, V43).
 */
export default function Page() {
  const mail = <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;
  return (
    <LegalPage title="Versions and changes" updated={latestUpdate()}>
      <p>
        When you agree to our Terms of Service and Privacy Policy, we record which versions you agreed to. A significant change gets a new version, which
        you&rsquo;re asked to agree to. Smaller changes that only clarify what we do, add to what you get, or keep less of your information keep the same version:
        we move the &ldquo;Last updated&rdquo; date and list them below under <a href="#wording-updates">Wording updates</a>.
      </p>

      <h2 id="versions">Versions</h2>
      <p>The versions people have agreed to, newest first.</p>
      <ul>
        {LEGAL_VERSIONS.map((v) => {
          const current = v.terms === LEGAL.termsVersion && v.privacy === LEGAL.privacyVersion;
          return (
            <li key={`${v.terms}-${v.privacy}`} data-testid={`version-${v.terms}`}>
              <strong>{v.date}</strong>: Terms of Service version {v.terms} and Privacy Policy version {v.privacy}
              {current ? (
                <>
                  {" "}
                  (current: <Link href="/legal/terms">Terms of Service</Link>, <Link href="/legal/privacy">Privacy Policy</Link>)
                </>
              ) : null}
              . What changed from the earlier versions, which weren&rsquo;t numbered:
              <ul>
                {v.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <p>
        Our <Link href="/legal/dpa">Data Processing Agreement</Link> has its own version numbers. Version {LEGAL.dpaVersion}, in effect from {LEGAL.dpaSince}, is
        the current one.
      </p>
      <p>
        Earlier versions, including those from before we numbered them, are kept and are available on request. For a copy of any earlier version, or of the
        version you agreed to, email {mail}.
      </p>

      <h2 id="wording-updates">Wording updates</h2>
      <p>
        Changes since the current versions took effect, newest first. None of them needed a new agreement. The current wording was last updated on{" "}
        {LEGAL.termsUpdated} (Terms of Service), {LEGAL.privacyUpdated} (Privacy Policy) and {LEGAL.dpaUpdated} (Data Processing Agreement).
      </p>
      <ul data-testid="wording-updates">
        {WORDING_UPDATES.map((u) => (
          <li key={u.date}>
            <strong>{u.date}</strong>
            <ul>
              {(["terms", "privacy", "dpa"] as const).flatMap((doc) =>
                (u[doc] ?? []).map((line) => (
                  <li key={`${doc}-${line}`}>
                    {DOC_NAMES[doc]}: {line}
                  </li>
                )),
              )}
            </ul>
          </li>
        ))}
      </ul>
    </LegalPage>
  );
}
