-- Decision 5: an optional contact line a business shows its own clients (Settings > Branding). Additive only.
ALTER TABLE "Workspace" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "contactPhone" TEXT;
