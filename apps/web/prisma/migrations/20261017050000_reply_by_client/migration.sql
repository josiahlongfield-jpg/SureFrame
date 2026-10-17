-- Who wrote a reply: the client, or the team. Until now that was "no team author",
-- which a deleted team member's replies would also match from then on.
ALTER TABLE "Reply" ADD COLUMN "byClient" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Reply" SET "byClient" = true WHERE "authorUserId" IS NULL;
