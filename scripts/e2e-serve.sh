#!/bin/sh
# Serves the production build on a throwaway demo database for Playwright.
# Run `npm run build` first. With E2E_EMPTY=1 it serves an empty database
# instead (no users), for the first-run setup tests.
set -e
DB="${E2E_EMPTY:+e2e-setup}"
DB="${DB:-e2e}"
export DATABASE_URL="file:./$DB.db"
export AUTH_SECRET="${AUTH_SECRET:-e2e-only-secret-not-for-production-use}"
export NEXTAUTH_URL="http://localhost:${PORT:-3456}"
rm -f "prisma/$DB.db" "prisma/$DB.db-journal"
npx prisma migrate deploy
if [ -z "$E2E_EMPTY" ]; then npx tsx scripts/seed-demo.ts; fi
exec npx next start -p "${PORT:-3456}"
