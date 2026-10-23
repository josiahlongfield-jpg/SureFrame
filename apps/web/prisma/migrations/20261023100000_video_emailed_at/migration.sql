-- When we last emailed the client this video, so the Send box can say "Emailed" truthfully after a reload. Additive only.
ALTER TABLE "Video" ADD COLUMN "emailedAt" TIMESTAMP(3);
