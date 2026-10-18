import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { loadVideo } from "./load";

/**
 * A video address with nothing behind it is a real 404 (app/v/not-found.tsx). Checked here, above the page's
 * loading screen: once that screen has been sent, the response has already said 200.
 */
export default async function VideoLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  if (!(await loadVideo((await params).id))) notFound();
  return children;
}
