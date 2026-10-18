-- Questions clients type into the help chat on their pages (question text and business only), for a weekly digest.
CREATE TABLE "ClientQuestion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientQuestionDigest" (
    "id" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "questions" INTEGER NOT NULL,

    CONSTRAINT "ClientQuestionDigest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientQuestion_createdAt_idx" ON "ClientQuestion"("createdAt");
CREATE INDEX "ClientQuestion_workspaceId_idx" ON "ClientQuestion"("workspaceId");
CREATE INDEX "ClientQuestionDigest_sentAt_idx" ON "ClientQuestionDigest"("sentAt");

ALTER TABLE "ClientQuestion" ADD CONSTRAINT "ClientQuestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
