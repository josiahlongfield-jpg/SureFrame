import type { Metadata } from "next";
import Login from "../login/page";

export const metadata: Metadata = { title: "Create your free account" };

/**
 * Where "Start free" goes: the sign-in page worded for a new account, then on to the recorder (V8). The same email
 * signs in an existing account, so it's the one form either way.
 */
export default async function Signup({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <Login searchParams={Promise.resolve({ next: next ?? "/record", signup: "1" })} />;
}
