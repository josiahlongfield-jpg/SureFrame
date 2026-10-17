-- First steps for new owners: the welcome step, the recovery key reminder and the checklist.
ALTER TABLE "User" ADD COLUMN "onboardedAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN "recoveryKeySavedAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN "firstStepsHiddenAt" TIMESTAMP(3);

-- Existing accounts skip the welcome step, except owners whose business is still named after their
-- email ("sam's workspace"): they're asked once for the real name, which clients see.
UPDATE "User" u SET "onboardedAt" = u."createdAt"
WHERE NOT EXISTS (
  SELECT 1 FROM "Membership" m JOIN "Workspace" w ON w.id = m."workspaceId"
  WHERE m."userId" = u.id AND m.role = 'OWNER' AND w.name LIKE '%''s workspace'
);

-- Existing businesses were shown their recovery key when it was made; they aren't reminded again.
UPDATE "Workspace" SET "recoveryKeySavedAt" = now() WHERE "keyFingerprint" IS NOT NULL;
