"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import PageLoading from "@/components/PageLoading";

/**
 * The support page, started afresh (forms closed and empty) at each new address, the loading screen
 * showing until it's drawn. Next keeps loading.tsx's boundary when only the query changes, as after a
 * power (?done=…), so without this the page a form is sent to streams in under a boundary that's already
 * on screen. React then holds the old page until all of the new one has arrived, and if a part arrives
 * just as React looks at it, React misses it and never shows the page: the form stays on "Working…".
 */
export default function Fresh({ children }: { children: ReactNode }) {
  return (
    <Suspense key={useSearchParams().toString()} fallback={<PageLoading />}>
      {children}
    </Suspense>
  );
}
