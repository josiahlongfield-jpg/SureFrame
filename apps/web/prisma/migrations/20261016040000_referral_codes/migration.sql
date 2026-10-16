-- CreateTable
CREATE TABLE "ReferralCode" (
    "code" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "usedByWorkspaceId" TEXT,
    "rewardDueAt" TIMESTAMP(3),
    "rewardAppliedAt" TIMESTAMP(3),
    "rewardLapsedAt" TIMESTAMP(3),
    "rewardEndedAt" TIMESTAMP(3),

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_workspaceId_key" ON "ReferralCode"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_usedByWorkspaceId_key" ON "ReferralCode"("usedByWorkspaceId");

-- CreateIndex
CREATE INDEX "ReferralCode_rewardDueAt_idx" ON "ReferralCode"("rewardDueAt");

-- AddForeignKey
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
