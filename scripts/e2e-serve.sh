#!/bin/sh
# Serves the production build on a throwaway demo database for Playwright.
# Run `npm run build` first. With E2E_EMPTY=1 it serves an empty database
# instead (no users), for the first-run setup tests.
#
# SQLite by default (prisma/e2e.db). Set E2E_POSTGRES_URL to a PostgreSQL URL
# (e.g. postgresql://kanbun:pw@localhost:5432/kanbun_e2e) to run against
# PostgreSQL: that database, and one with a "_setup" suffix for E2E_EMPTY, are
# dropped and recreated. REDIS_URL, if set, is passed through.
# With E2E_JOIN=<url of the first server> it starts one more instance on the
# first server's database instead (no reset, no seed).
set -e
DB="${E2E_EMPTY:+e2e-setup}"
DB="${DB:-e2e}"
if [ -n "$E2E_POSTGRES_URL" ]; then
  if [ -n "$E2E_EMPTY" ]; then
    # Same server, database name + "_setup" (query string kept).
    DATABASE_URL=$(node -e 'const u = new URL(process.argv[1]); u.pathname += "_setup"; console.log(u.toString())' "$E2E_POSTGRES_URL")
  else
    DATABASE_URL="$E2E_POSTGRES_URL"
  fi
  export DATABASE_URL
else
  export DATABASE_URL="file:./$DB.db"
fi
export AUTH_SECRET="${AUTH_SECRET:-e2e-only-secret-not-for-production-use}"
export NEXTAUTH_URL="http://localhost:${PORT:-3456}"
export ATTACHMENTS_DIR="prisma/$DB-attachments"
if [ -n "$E2E_JOIN" ]; then
  # A second instance on the same database (scale-out tests): wait until the
  # first one at $E2E_JOIN has reset and seeded it, then share its attachments.
  export ATTACHMENTS_DIR="prisma/e2e-attachments"
  until node -e 'fetch(process.argv[1]).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' "$E2E_JOIN"; do
    sleep 1
  done
  exec npx next start -p "${PORT:-3456}"
fi
rm -rf "prisma/$DB-attachments"
if [ -n "$E2E_POSTGRES_URL" ]; then
  node scripts/db.mjs reset
else
  rm -f "prisma/$DB.db" "prisma/$DB.db-journal"
  node scripts/db.mjs deploy
fi
if [ -z "$E2E_EMPTY" ]; then npx tsx scripts/seed-demo.ts; fi
exec npx next start -p "${PORT:-3456}"
