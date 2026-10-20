-- Maintenance mode (2026-10-15 to 2026-10-20) paused every deletion and its warning email. Before the site opens
-- again, anything that fell due meanwhile, or falls due too soon to be warned, gets its usual notice period from now,
-- so nothing is deleted without its warning. Data only; later dates are untouched.

-- Recordings' server copies: at least 2 days (the warning goes 24 hours before).
UPDATE "Video" SET "purgeAt" = now() + interval '2 days', "expiryWarnedAt" = NULL
WHERE "purgeAt" IS NOT NULL AND "purgeAt" < now() + interval '2 days' AND "status" NOT IN ('EXPIRED', 'RECORDING');

-- Removed clients: at least 4 days (warned 3 days before).
UPDATE "Client" SET "purgeAt" = now() + interval '4 days', "purgeWarnedAt" = NULL
WHERE "removedAt" IS NOT NULL AND "purgeAt" IS NOT NULL AND "purgeAt" < now() + interval '4 days';

-- Accounts due for deletion: at least 4 days (warned 3 days before), their workspaces alike.
UPDATE "User" SET "deleteAt" = now() + interval '4 days', "deletionWarnedAt" = NULL
WHERE "deleteAt" IS NOT NULL AND "deleteAt" < now() + interval '4 days';
UPDATE "Workspace" SET "deleteAt" = now() + interval '4 days'
WHERE "deleteAt" IS NOT NULL AND "deleteAt" < now() + interval '4 days';

-- Unsent replies (cleared 7 days after recording): at least 2 more days.
UPDATE "Reply" SET "heldAt" = now() - interval '5 days'
WHERE "heldAt" IS NOT NULL AND "heldAt" < now() - interval '5 days';
