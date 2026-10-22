-- CreateTable
CREATE TABLE "SignInCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignInCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignInCode_email_idx" ON "SignInCode"("email");

-- CreateIndex
CREATE INDEX "SignInCode_expiresAt_idx" ON "SignInCode"("expiresAt");
