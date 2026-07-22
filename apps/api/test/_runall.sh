#!/usr/bin/env bash
# Sequential e2e runner.
#
#  · /auth/login is throttled to 5 attempts/min per IP → suites are spaced out, otherwise a
#    back-to-back run fails with 429 and looks like a product bug.
#  · Each suite gets a FRESH database. They are not isolated from one another: chain-replay
#    asserts absolute pallet/debt totals and would read a previous suite's leftovers as its own.
#  · The reset is TRUNCATE + seed (test/_reset-data.mjs), never `prisma migrate reset`.
#    Dropping the schema under a live API re-creates every enum with a new type OID while the
#    API's Prisma pool still caches the old one; the next query then dies with
#    `XX000 cache lookup failed for type NNNNN` — which reads exactly like a code bug and is not.
#
# Start the API yourself first (it stays up for the whole run):
#   DATABASE_URL=postgresql://postgres@localhost:5433/smartblok_test API_PORT=4100 node dist/main.js &
#   bash test/_runall.sh e2e-core.mjs import/excel-parity.e2e.mjs …
set -u
cd "$(dirname "$0")/.." || exit 1
export API_URL=${API_URL:-http://localhost:4100/api}
export DATABASE_URL=${DATABASE_URL:-postgresql://postgres@localhost:5433/smartblok_test}

curl -s "$API_URL/health" | grep -q '"status":"ok"' || { echo "!! API is not up on $API_URL"; exit 1; }

fails=0
for f in "$@"; do
  echo ""
  echo "##################### $f"
  node test/_reset-data.mjs >/dev/null 2>&1 || { echo "!! reset failed"; fails=$((fails + 1)); continue; }
  node "test/$f"
  code=$?          # capture BEFORE any pipe — `| tail` would report tail's status
  [ "$code" -eq 0 ] || fails=$((fails + 1))
  echo "--- exit=$code ---"
  sleep 70         # login throttle window
done
echo ""
echo "ALL DONE — failed suites: $fails"
exit $((fails > 0 ? 1 : 0))
