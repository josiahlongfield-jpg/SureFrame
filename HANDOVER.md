# SureFrame handover guide

For any developer or AI coding tool that picks up SureFrame. Read this first, then the [README](README.md) (local setup, environment, deployment details).

SureFrame (https://sureframe.app) is a private video messaging app for businesses and their clients. It is owned and run by one person, a sole trader in Queensland, Australia, who is not a developer. Explain changes to him in plain language, and ask before anything that can't be undone.

## 1. The ground rules

These protect real customers' data. Don't break them without the owner's explicit say-so.

1. **Never wipe or reset production data.** Real businesses and their clients use the live site.
2. **Database migrations are additive only.** Add tables and columns. Don't drop or rename them in the same release that stops using them. Migrations live in `apps/web/prisma/migrations`. Make them locally with `npx prisma migrate dev`. A production deploy applies them automatically (`vercel-build` in `apps/web/package.json`); preview deploys never do.
3. **Don't rename anything called `framecast`.** That was the old name of the database, storage keys and browser keys. Renaming orphans recordings and keys already saved in people's browsers.
4. **The server never sees videos, replies, notes or to-dos in plain form.** They're end-to-end encrypted in the browser (`src/lib/e2e/`). Keys stay on devices; clients get theirs in the `#k=` part of their personal link. Never add code that sends plaintext content or keys to the server, to logs or to email.
5. **Don't change prices or plan limits** (`src/lib/plans.ts`) without the owner's decision.
6. **Legal pages are versioned** (`src/lib/legal.ts`). A wording fix keeps the version. A change to what the Terms or Privacy policy promise needs a new version, which emails every account holder. After publishing a new version, check the next day that `TermsNotice` rows are being created by the daily job (`/api/cron/purge`; `TERMS_NOTICES` must be `on` in Vercel).
7. **Layouts must work down to 320px wide.** Many clients use phones.
8. **Secrets live only in Vercel environment variables.** Never commit them or paste them into chats or issues.
9. **Production deploys need the owner's go-ahead.** Pushing to `main` deploys to the live site.

## 2. What's in the repository

| Path | What |
|---|---|
| `apps/web` | The product: a Next.js 15 (App Router) site and API. This is almost all of the work. |
| `apps/web/src/app` | Pages and API routes (`src/app/api/...`). |
| `apps/web/src/lib` | Logic: `recorder/` (browser recording and crash-safe upload), `e2e/` (encryption), `billing.ts`, `plans.ts`, `stripe.ts` (payments), `mail.ts` (email), `storage.ts` (video files), `permissions.ts` (who can see what), `legal.ts`, `support/` (help chat and the owner's support console), `connector/` (the Claude connector). |
| `apps/web/src/components` | React components. `Recorder.tsx`, `WatchView.tsx` (the video page) and `SendPanel.tsx` are the big ones. |
| `apps/web/prisma` | Database schema and migrations (Prisma 6, Postgres). |
| `apps/web/e2e` | About 70 browser test suites (Playwright with Chromium). See section 5. |
| `apps/extension` | The Chrome extension (camera bubble while recording). Its own README and STORE.md. |
| `apps/connector` | The Claude Desktop extension (`.mcpb`) for the Claude connector. |
| `apps/mobile` | An Expo app. **Not released**; the live product is the website. |

Stack: Next.js 15, React 19, TypeScript, Tailwind 4, Prisma 6 with Postgres, Auth.js v5 (email-link sign-in), Stripe, S3-compatible storage (Cloudflare R2), Resend for email, the Anthropic API for the help chat. Scheduled jobs are in `apps/web/vercel.json`: `/api/cron/reminders` every 5 minutes and `/api/cron/purge` daily.

## 3. Accounts and services

The owner holds every login. Ask him for access; don't share his password.

| Service | What it does for SureFrame | Where |
|---|---|---|
| GitHub | The code: `josiahlongfield-jpg/SureFrame` (private) | github.com |
| Vercel | Hosting, the live site, environment variables, logs, both domains (`sureframe.app`, `getsureframe.com`) and the Neon Postgres database (Storage tab) | team `hoardconquer`, project `sureframe` |
| Cloudflare R2 | Encrypted video files (bucket `sureframe-videos`) and the speech model | dash.cloudflare.com |
| Resend | All email (sign-in links, reminders, notifications), domain `sureframe.app` | resend.com |
| Stripe | Subscriptions (Managed Payments). Webhook `https://sureframe.app/api/webhooks/stripe` | dashboard.stripe.com |
| Google Workspace | The `support@sureframe.app` inbox; `admin@` is an alias | admin.google.com |
| Anthropic Console | `ANTHROPIC_API_KEY` for the help chat and AI add-on. Keys can expire, so check the expiry. | console.anthropic.com |
| Chrome Web Store | The extension listing (ID `dhpgmfccafneomgdklkiphgfjgmkdaeo`) | chrome.google.com/webstore/devconsole |

Every environment variable is listed, with what it does, in `apps/web/.env.example`. The live values are in Vercel, under Project, Settings, Environment Variables. After changing one, redeploy for it to take effect.

## 4. Making a change safely

1. Work on a branch, never directly on `main`. Every pushed branch gets a Vercel preview link. Check which database a preview uses before testing on it.
2. Run the type check and linter: `cd apps/web && npx tsc --noEmit && npx eslint`.
3. Run the test suites that cover what you changed (section 5), and the whole set before anything big.
4. Show the owner what changed in plain words. With his go-ahead, merge to `main`. Vercel then builds and publishes the live site (it applies any new migrations first).
5. After it's live, check Vercel's Logs for errors.

## 5. Tests

`apps/web/e2e/run-all.sh` runs every suite with the settings each needs, against its own server on port 3130 and its own database `framecast_suites` (it never touches anything live):

```bash
cd apps/web && npm install
APP_DIR=$PWD bash e2e/run-all.sh                          # everything; results in /tmp/claude-0/suites/summary.txt
APP_DIR=$PWD ONLY="record replies" bash e2e/run-all.sh    # just these suites
```

It needs a local Postgres (`docker compose up -d` at the repository root, then set `DATABASE_URL` in `apps/web/.env`), Chromium (`npx playwright install chromium`, or set `CHROMIUM` to a Chromium you already have), and `ffmpeg` for `sharp-stills`. Each suite prints `PASS`/`FAIL` lines and exits non-zero on failure. Known quirk: `fx-shell` in group E can fail on rate limits when rerun quickly; rerun it on its own.

The most important suites guard the core promise, which is never losing a recording: `record`, `replies`, `multipart`, `server-backup`, `planner`.

## 6. When something breaks

The owner can do these himself from the Vercel dashboard, without any code:

- **Undo a bad release:** Vercel, project `sureframe`, Deployments. Find the last production deployment that worked, open its menu, choose **Instant Rollback** (or Promote). The site switches back in seconds. Fix the code afterwards, then publish again.
- **Take the site offline for everyone except the owner:** set `MAINTENANCE` to `on` in Environment Variables and redeploy. The owner opens `https://sureframe.app/?owner=<MAINTENANCE_KEY>` once per browser to keep using the site. Payments webhooks and scheduled jobs keep running; the jobs pause their emails and deletions. Set it back to `off` and redeploy to reopen.
- **See errors:** Vercel, project, Logs. Problems that need a person (refunds, disputes) are also emailed to `support@` with "[Action needed]" in the subject (`src/lib/founderAlert.ts`).
- **The help chat stops answering:** usually an expired or missing `ANTHROPIC_API_KEY`. Make a new key in the Anthropic Console, paste it into Vercel, then redeploy.
- **Emails stop:** check Resend (plan limits, domain still verified) and `RESEND_API_KEY` / `MAIL_FROM` in Vercel.

## 7. Bringing in help

**A freelance developer.** Any developer comfortable with Next.js, TypeScript, Prisma and Postgres can work on this. Give them:
- access to the GitHub repository (as a collaborator), and this guide;
- not the owner's Vercel login. They work on branches; the owner (or one trusted person) merges and publishes, and can roll back as above;
- if they need production settings, add them as a Vercel team member for the job and remove them afterwards. Then change any secrets they saw: `AUTH_SECRET` signs everyone out, so leave that one unless it's needed.

**Another AI coding tool.** Point it at this repository. Claude Code reads `CLAUDE.md`, and most other tools read `AGENTS.md`. Both send it here. Ask it to follow section 1 and to run the tests in section 5 before saying a change is done.
