"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { reportClientError } from "@/lib/clientError";

/** Pages only signed-in staff use; everywhere else (client pages, the public site) gets a neutral message. */
const APP_PAGES = ["/library", "/record", "/clients", "/team", "/settings", "/support"];
/** Pages only a business's clients use. A video page (/v/) is the team's too, so it's told apart below. */
const CLIENT_PAGES = ["/inbox", "/reminders/off"];

/**
 * On a video page: whether this browser is a client's, not the team's. It holds a client's key from their personal
 * link and no team key (lib/e2e/keystore.ts keeps both under "framecast.key.").
 */
function clientBrowser() {
  try {
    const keys = Object.keys(localStorage);
    return keys.some((k) => k.startsWith("framecast.key.client:")) && !keys.some((k) => k.startsWith("framecast.key.team:"));
  } catch {
    return false;
  }
}

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const path = usePathname() ?? "/";
  useEffect(() => {
    reportClientError("page", error);
  }, [error]);
  const inApp = APP_PAGES.some((p) => path === p || path.startsWith(`${p}/`));
  const records = path.startsWith("/record") || path.startsWith("/v/");
  // A client is pointed to their own videos and to the business, never to SureFrame's site or its support.
  const [clientVideo, setClientVideo] = useState(false);
  useEffect(() => setClientVideo(path.startsWith("/v/") && clientBrowser()), [path]);
  const client = clientVideo || CLIENT_PAGES.some((p) => path === p || path.startsWith(`${p}/`));
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold text-ink">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        {client
          ? `Please try again. ${clientVideo ? "If you were recording a reply, it's kept and will be waiting when you open this video again. " : ""}If it keeps happening, tell the business that sent you the video.`
          : records
            ? "A recording in progress is kept in this browser and finishes uploading next time you open SureFrame here."
            : "Please try again. If it keeps happening, let us know."}
      </p>
      {error.digest && <p className="mt-2 text-xs text-dim">Error reference: {error.digest}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button onClick={reset} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">Try again</button>
        <Link href={client ? "/inbox" : inApp ? "/library" : "/"} className="rounded-xl border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-hover">
          {client ? "Back to my videos" : inApp ? "Go to library" : "Go home"}
        </Link>
      </div>
    </main>
  );
}
