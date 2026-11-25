#!/bin/bash
# Runs every automated suite in apps/web/e2e with the settings each needs, against its OWN server (port 3130)
# and OWN database (framecast_suites), so it never touches anything live. The suites start their own
# fake Stripe (12111) and fake AI (12112), so nothing else may use those ports. See HANDOVER.md section 5.
# Usage: APP_DIR=<clone>/apps/web ./e2e/run-all.sh            (all groups)
#        APP_DIR=... ONLY="fx-site signin-code" ./e2e/run-all.sh   (just these, in group A's settings unless named below)
# Results: $OUT/summary.txt (one line per suite: rc, PASS and FAIL counts) and $OUT/<group>/<suite>.log.
set -u
: "${APP_DIR:?set APP_DIR to the apps/web folder of your clone}"
CHROMIUM=${CHROMIUM:-}  # empty uses the Chromium Playwright installed (npx playwright install chromium)
OUT=${OUT:-/tmp/claude-0/suites}; P=${P:-3130}; DB=${DB:-framecast_suites}
mkdir -p "$OUT"; : > "$OUT/summary.txt"
# The fake Stripe keeps its state in a file. Give each run its own, so another test server on this machine
# (which would otherwise share the default file in the temp folder) can never swap the price list under it.
export FAKE_STRIPE_STATE=${FAKE_STRIPE_STATE:-$OUT/fake-stripe.json}; rm -f "$FAKE_STRIPE_STATE"
cd "$APP_DIR" || exit 1
pg_isready -q -h localhost || { service postgresql start >/dev/null 2>&1; sleep 3; }
BASEURL=$(grep -o '^DATABASE_URL="[^"]*"' .env | sed 's/^DATABASE_URL="//;s/"$//')
URL=$(echo "$BASEURL" | sed -E "s#/[^/?]+(\?|$)#/$DB\1#")
MAINT=$(echo "$URL" | sed -E "s#/$DB#/postgres#")
export DATABASE_URL="$URL" DATABASE_URL_UNPOOLED="$URL"
COMMON="VERCEL_ENV=development TERMS_NOTICES=on CRON_SECRET=test-cron-secret STRIPE_SECRET_KEY=sk_test_fake STRIPE_API_BASE=http://localhost:12111 STRIPE_WEBHOOK_SECRET=whsec_test SUPPORT_EMAIL=owner@test.dev ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://localhost:12112 APP_URL=http://localhost:$P AUTH_URL=http://localhost:$P AUTH_TRUST_HOST=true"

group() { # name, build env, server env, suite env, suites...
  local G=$1 BUILDENV=$2 SERVENV=$3 RUNENV=$4; shift 4
  local L="$OUT/$G"; mkdir -p "$L"
  fuser -k $P/tcp >/dev/null 2>&1; sleep 1
  dropdb --maintenance-db="$MAINT" --if-exists $DB 2>/dev/null; createdb --maintenance-db="$MAINT" $DB || { echo "createdb failed"; exit 1; }
  npx prisma migrate deploy > "$L/migrate.log" 2>&1 || { echo "migrate failed"; exit 1; }
  if [ -n "$BUILDENV" ] || [ ! -f .next/BUILD_ID ] || [ -n "${REBUILD:-}" ]; then
    env $COMMON $BUILDENV npx next build > "$L/build.log" 2>&1 || { echo "build failed: $L/build.log"; exit 1; }
    REBUILD=$BUILDENV  # rebuild again after a group with special build settings
  fi
  env $COMMON $SERVENV setsid npx next start -p $P > "$L/server.log" 2>&1 < /dev/null &
  for i in $(seq 1 60); do curl -s -o /dev/null --max-time 60 http://localhost:$P/login && break; sleep 2; done
  for s in "$@"; do
    env BASE=http://localhost:$P PGDATABASE=$DB CHROMIUM=$CHROMIUM CRON_SECRET=test-cron-secret DEV_LOG="$L/server.log" $RUNENV timeout 900 node e2e/$s.mjs "$L/shots" > "$L/$s.log" 2>&1; rc=$?
    echo "$s rc=$rc pass=$(grep -c ^PASS "$L/$s.log") fail=$(grep -c ^FAIL "$L/$s.log")" | tee -a "$OUT/summary.txt"
  done
  fuser -k $P/tcp >/dev/null 2>&1
}

# Group A: dev login, rate limits off. (ai-model needs huggingface.co for the speech model; skip it where that's blocked.)
A="connectors account-grace agree-gate ai-assist ai-position branding-name branding bubble camera-fill camera-later client-help client-removal client-rows comp compose expiry extension first-link frames-fit free-limit fx-client fx-send fx-shell fx-site library-days library-groups link-off mic-level mobile-chat multipart page-end personal-link phone-cameras phone-inputs phone-reply planner record recorder-notes referrals rekey reminders replies reply-composer seat-pause security sendmany server-backup session-timeout sharp-stills staff-access staff-self support-console suspend team-links team video-frame leftovers-a staff-own refresh-top bell conversations send-group"
if [ -n "${ONLY:-}" ]; then
  group A "" "RATE_LIMITS=off UPLOAD_JOIN_BYTES=65536 AUTH_DEV_LOGIN=true" "RATE_LIMITS=off" $ONLY
  exit 0
fi
group A "" "RATE_LIMITS=off UPLOAD_JOIN_BYTES=65536 AUTH_DEV_LOGIN=true" "RATE_LIMITS=off" $A
# Group B: billing and support need rate limits ON.
group B "" "AUTH_DEV_LOGIN=true" "" billing support
# Group C: founding prices are only offered while FOUNDING_ENDS is in the future.
group C "" "FOUNDING_ENDS=2099-12-31 AUTH_DEV_LOGIN=true" "" offers
# Group D: the emailed sign-in link and the Claude sign-in code (no dev login).
group D "" "RATE_LIMITS=off AUTH_EMAIL_LINKS=true AUTH_DEV_LOGIN=false" "RATE_LIMITS=off" signin-code keep-email keep-real key-stays send-busy
# Group E: sign-in limits need rate limits ON.
group E "" "AUTH_EMAIL_LINKS=true AUTH_DEV_LOGIN=false" "" signin fx-shell
# Group G: the before-recording "add the extension" prompt only exists when built with a store link.
group G "NEXT_PUBLIC_EXTENSION_URL=https://chromewebstore.google.com/detail/sureframe/test" "RATE_LIMITS=off UPLOAD_JOIN_BYTES=65536 AUTH_DEV_LOGIN=true" "RATE_LIMITS=off EXPECT_URL=https://chromewebstore.google.com/detail/sureframe/test" extension-prompt
echo "ALL DONE: $OUT/summary.txt"; grep -v "fail=0" "$OUT/summary.txt" || echo "every suite passed"
