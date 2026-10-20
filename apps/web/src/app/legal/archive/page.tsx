import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { LEGAL, LEGAL_VERSIONS } from "@/lib/legal";

export const metadata = { title: "Versions of our terms" };

/** Every version of the Terms of Service and Privacy Policy people have agreed to (LEGAL_VERSIONS in lib/legal.ts). */
export default function Page() {
  const mail = <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;
  return (
    <LegalPage title="Versions of our terms">
      <p>
        When you agree to our Terms of Service and Privacy Policy, we record which versions you agreed to. These are the versions people have agreed to, newest
        first.
      </p>
      <ul>
        {LEGAL_VERSIONS.map((v) => {
          const current = v.terms === LEGAL.termsVersion && v.privacy === LEGAL.privacyVersion;
          return (
            <li key={`${v.terms}-${v.privacy}`} data-testid={`version-${v.terms}`}>
              <strong>{v.date}</strong>: Terms of Service version {v.terms} and Privacy Policy version {v.privacy}
              {current ? (
                <>
                  {" "}
                  (current: <Link href="/legal/terms">Terms of Service</Link>, <Link href="/legal/privacy">Privacy Policy</Link>; their wording was last
                  updated on {LEGAL.termsUpdated === LEGAL.privacyUpdated ? LEGAL.termsUpdated : `${LEGAL.termsUpdated} and ${LEGAL.privacyUpdated}`}, with changes that only add to or explain what you get, or keep less of your
                  information, so there was nothing new to agree to)
                </>
              ) : null}
              . What changed:
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
        Earlier versions, including those from before we numbered them, are kept and are available on request. For a copy of any earlier version, or of the
        version you agreed to, email {mail}.
      </p>
      <p>
        Our <Link href="/legal/dpa">Data Processing Agreement</Link> has its own version numbers. Version {LEGAL.dpaVersion}, in effect from {LEGAL.dpaSince}, is
        the current one; its wording was last updated on {LEGAL.dpaUpdated}.
      </p>
    </LegalPage>
  );
}
