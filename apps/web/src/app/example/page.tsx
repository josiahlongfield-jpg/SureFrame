import type { Metadata } from "next";
import ExampleClientPages from "@/components/ExampleClientPages";

export const metadata: Metadata = {
  title: "What your client sees",
  description: "An example of the private video page, video list and email a client gets from a business using SureFrame.",
};

/** A sample of the client side, linked from the home page (V11). */
export default async function Example({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  return <ExampleClientPages initial={view === "inbox" || view === "email" ? view : "video"} />;
}
