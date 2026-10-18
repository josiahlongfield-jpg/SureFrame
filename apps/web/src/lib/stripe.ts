import Stripe from "stripe";
import { HttpError } from "@/lib/session";

let client: Stripe | undefined;

export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new HttpError(503, "Billing is not configured");
  // STRIPE_API_BASE points the client at a local fake for tests (e2e/fake-stripe.mjs);
  // the live site ignores it so the secret key can only ever go to Stripe.
  const testBase = process.env.VERCEL_ENV === "production" ? undefined : process.env.STRIPE_API_BASE;
  if (process.env.STRIPE_API_BASE && !testBase && !client) console.error("[billing] STRIPE_API_BASE is set in production and ignored");
  const base = testBase ? new URL(testBase) : null;
  client ??= new Stripe(
    process.env.STRIPE_SECRET_KEY,
    base ? { host: base.hostname, port: Number(base.port), protocol: base.protocol === "http:" ? "http" : "https" } : undefined,
  );
  return client;
}

export { appUrl } from "@/lib/appUrl";
