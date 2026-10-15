-- CreateTable
CREATE TABLE "VideoThumb" (
    "videoId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoThumb_pkey" PRIMARY KEY ("videoId")
);

-- AddForeignKey
ALTER TABLE "VideoThumb" ADD CONSTRAINT "VideoThumb_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
