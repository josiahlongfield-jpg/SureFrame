# SureFrame

Async screen and camera recording for teams, built to protect every take from crashes and dropped connections.
The product name lives in `apps/web/src/lib/brand.ts` and `apps/mobile/app.json`. Internal identifiers (database name, browser storage keys) still say `framecast` on purpose: renaming them would orphan keys and recordings already saved in browsers.

See [PLAN.md](PLAN.md) for product scope, pricing and architecture.

| Path | What |
|---|---|
| `apps/web` | Next.js 15 web app + API (recorder, share pages, library, Stripe billing) |
| `apps/mobile` | Expo SDK 57 app for iOS and Android (record, library, share) |

## Run the web app locally

```bash
docker compose up -d                 # Postgres
cd apps/web
cp .env.example .env                 # then set AUTH_SECRET (npx auth secret)
npm install
npx prisma migrate dev
npm run dev                          # http://localhost:3000
```

With no S3 keys, uploads are stored on local disk and played back directly. That is enough to demo the full record → share flow.

## Run the mobile app

```bash
cd apps/mobile
npm install
EXPO_PUBLIC_API_URL=http://<your-computer-ip>:3000 npx expo run:ios   # or run:android
```

The camera and secure storage need a development build (`expo run:*` or `eas build --profile development`), not Expo Go.

## How recordings stay safe

1. The browser recorder emits a chunk every 2 seconds and writes it to IndexedDB **before** uploading it.
2. Chunks are grouped into 5 MiB parts and uploaded in order with retries (`PUT /api/videos/:id/parts/:n`). Parts are idempotent, so a resend after a crash is harmless.
3. A chunk is deleted locally only after the server confirms the part that contains it.
4. On the next visit to the recorder, anything left over is uploaded and the video is finished automatically.
5. On mobile, the finished file is moved to the app's documents folder with a manifest and uploaded the same way; uploads resume on next launch.

## Privacy

Videos and replies are end-to-end encrypted in the browser before upload; see section 6 of PLAN.md. The first device to record creates the team key and shows a recovery key once. Clients get their key inside their personal link's `#k=` fragment. Schedule `GET /api/cron/purge` daily (`vercel.json` does this on Vercel) to delete expired relay copies and removed clients whose 30 days are up.

## Tests

`apps/web/e2e/record.mjs` drives Chromium with a fake camera through sign in, recording, playback, commenting, and a crash mid-recording followed by recovery.
`apps/web/e2e/replies.mjs` covers the encrypted conversation: the server only stores ciphertext, a client on a phone-sized screen opens their personal link and replies with text, voice and video, an interrupted reply is recovered, a second device needs the recovery key, seats are capped and expired relay copies are deleted.
`apps/web/e2e/billing.mjs` covers billing and account controls against a local fake Stripe (`e2e/fake-stripe.mjs`; start the app with `STRIPE_SECRET_KEY=sk_test_fake STRIPE_API_BASE=http://localhost:12111 STRIPE_WEBHOOK_SECRET=whsec_test`): catalog created once, Managed Payments checkout, webhooks, seats, cloud backup, in-place upgrades, cancellation, data export, account deletion and rate limits. `e2e/branding.mjs` (same setup) covers custom branding: paid-only, logo and colour checks, the live client preview (video page, inbox and email at desktop and phone width, before and after saving), and what clients see. Preview screenshots (`brand-*.png`) go to the folder given as its argument.
`apps/web/e2e/signin.mjs` covers email-link sign-in (link works once, returns you to the page you asked for, sign-in emails are rate limited). `apps/web/e2e/security.mjs` covers open redirects, the app's one-time-code sign-in handoff, oversized upload requests and cron secrets. `multipart.mjs` uses tiny parts, so run it without `S3_BUCKET`. `apps/web/e2e/planner.mjs` covers to-dos and notes: private versus shared items, a client ticking off a shared to-do, what the client can and can't see or change, and ciphertext-only storage.
`apps/web/e2e/reminders.mjs` covers repeating to-dos and reminder emails: business settings with a live preview, a weekly to-do with several reminders at the right local times, the reminder job, the next week's to-do appearing when the client ticks one off, the client opting out from the email, and emails never containing the to-do's text.
`apps/web/e2e/multipart.mjs` checks the upload protocol (out-of-order parts, retries, missing-part rejection, byte-exact assembly, range requests, auth).

```bash
cd apps/web && npm run build && npm start &
node e2e/record.mjs /tmp && node e2e/replies.mjs /tmp && node e2e/planner.mjs /tmp && node e2e/reminders.mjs /tmp && node e2e/multipart.mjs
# with the dev server started with AUTH_EMAIL_LINKS=true:
node e2e/signin.mjs
```

## Going to production

- Host `apps/web` on Vercel; Postgres on Neon or Supabase; storage on Cloudflare R2 (set `S3_*`).
- Stripe: set `STRIPE_SECRET_KEY`. Products and prices (Solo, Studio, Agency, extra client, cloud backup, each monthly and yearly) are created on first use by lookup key (`src/lib/billing.ts`), with the SaaS business-use tax code, so there are no price ids to copy. Checkout uses Managed Payments (Stripe is merchant of record and handles tax, fraud and disputes); accept its terms under Settings → Managed Payments, or set `STRIPE_MANAGED_PAYMENTS=off` for plain Checkout with Stripe Tax. Add a webhook endpoint `https://<domain>/api/webhooks/stripe` for `customer.subscription.created`, `.updated` and `.deleted`, `customer.deleted`, `charge.refunded` and `charge.dispute.created`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
- Ship mobile with `eas build` and `eas submit`. Paid upgrades in the iOS and Android apps must follow App Store and Play billing rules (RevenueCat recommended).

## Deploying on Vercel

1. Import the GitHub repo in Vercel and set **Root Directory** to `apps/web`.
2. Environment variables: `AUTH_SECRET` (random), `CRON_SECRET` (random), `APP_URL`, `RESEND_API_KEY` and `MAIL_FROM`, plus the Stripe, storage and support settings below. The app logs an error at start-up for any production setting that's missing (`src/instrumentation.ts`).
3. Storage tab: create a **Neon** Postgres database and connect it to the project. It sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
4. Deploy. The `vercel-build` script runs migrations for production deployments only, so preview builds never change the live database.

`AUTH_DEV_LOGIN=true` with `PREVIEW_PASSWORD` (a shared password for email sign-in) is for preview deployments without email; it is ignored in production and whenever `RESEND_API_KEY` is set. Test-only switches (`RATE_LIMITS=off`, `STRIPE_API_BASE`) are ignored in production too, and the mobile app's sign-in hand-off stays off there until `MOBILE_SIGNIN=on`.

Live at **https://sureframe.app** (bought through Vercel). `www.sureframe.app`, `getsureframe.com` and `www.getsureframe.com` redirect there. `APP_URL=https://sureframe.app` is set for production so emails, share links and Stripe redirects use it.

Without `S3_BUCKET`, videos are stored in Postgres (`StoredPart`) in 2 MB parts, under Vercel's 4.5 MB request limit. That suits a preview. For launch, use R2/S3 with direct-to-bucket (presigned) part uploads.

Sign-in links and reminder emails need `RESEND_API_KEY` and `MAIL_FROM`; without them they are only logged. Reminders, team digests and expiry warnings (recordings, and removed clients 3 days before they're deleted) are checked every 5 minutes, and expired copies and removed clients deleted, by `/api/cron/reminders`; `/api/cron/purge` does the daily clean-up (`vercel.json`, needs Vercel Pro). The daily job also emails `SUPPORT_EMAIL`, once a week, a digest of the questions clients asked the help chat on their pages (the chat itself never reaches support), grouped and counted with the business's name.

### Production storage (Cloudflare R2)

Set `S3_BUCKET`, `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (an R2 API token with Object Read & Write on the bucket). Browsers then upload encrypted parts straight to the bucket through short-lived presigned URLs, so video never passes through Vercel. The bucket needs this CORS policy:

```json
[{ "AllowedOrigins": ["https://sureframe.app"], "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
```

The `GET` in that rule is also what lets browsers download the on-device speech model (AI transcripts add-on): `/models/...` answers with a redirect to a short-lived bucket link, fetched from the app's page. Install the model once from **Support → Free plans → AI speech model → Install speech model** (founder only). It copies `onnx-community/whisper-base` at the current exact revision from Hugging Face into the bucket under `models/`, one file per request, and writes `models/manifest.json` (every file's sha256) last; browsers check each file against it. Press it again to update; it's safe to repeat.

Also add a lifecycle rule (bucket → Settings → Object lifecycle rules) that aborts incomplete multipart uploads after 7 days. The purge job already expires uploads abandoned for 7 days, and the rule catches any parts it misses.

### Sign in with Google

Create an OAuth client (Web application) in Google Cloud Console with redirect URI `https://sureframe.app/api/auth/callback/google`, then set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.
