-- The business's message to a client on the video page (ciphertext), replies held for review, and who reacted.
ALTER TABLE "Video" ADD COLUMN "message" TEXT;
ALTER TABLE "Reply" ADD COLUMN "heldAt" TIMESTAMP(3);
ALTER TABLE "Reaction" ADD COLUMN "authorUserId" TEXT;
ALTER TABLE "Reaction" ADD COLUMN "byClient" BOOLEAN NOT NULL DEFAULT false;
