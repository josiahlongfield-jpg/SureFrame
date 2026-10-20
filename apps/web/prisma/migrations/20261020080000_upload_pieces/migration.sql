-- Server backup of recordings as they're made (lib/pieces.ts).
ALTER TABLE "Video" ADD COLUMN "piecesAt" TIMESTAMP(3);
ALTER TABLE "Video" ADD COLUMN "recordedMs" INTEGER;
ALTER TABLE "Video" ADD COLUMN "partsJoined" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Video" ADD COLUMN "joinLockUntil" TIMESTAMP(3);

CREATE TABLE "UploadPiece" (
    "videoId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "offset" BIGINT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadPiece_pkey" PRIMARY KEY ("videoId","seq")
);

CREATE INDEX "UploadPiece_createdAt_idx" ON "UploadPiece"("createdAt");
