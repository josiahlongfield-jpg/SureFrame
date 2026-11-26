-- WB-20: who recorded a video or wrote a reply before they left the team, so the same login rejoining gets them back
-- (api/team/join). Plain ids with no foreign key, so deleting a login never touches the business's videos. Additive only.
ALTER TABLE "Video" ADD COLUMN "formerOwnerId" TEXT;

ALTER TABLE "Reply" ADD COLUMN "formerAuthorId" TEXT;
