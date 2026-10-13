-- Founding prices and discount offers (lib/founding.ts, lib/offers.ts): what Settings > Billing shows, synced from Stripe.
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "foundingPrices" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "discountLabel" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "discountEndsAt" TIMESTAMP(3);
