#!/bin/sh
# Serves the production build on a throwaway demo database for Playwright.
# Run `npm run build` first.
set -e
export DATABASE_URL="file:./e2e.db"
export AUTH_SECRET="${AUTH_SECRET:-e2e-only-secret-not-for-production-use}"
export NEXTAUTH_URL="http://localhost:${PORT:-3456}"
export ATTACHMENTS_DIR="prisma/e2e-attachments"
rm -f prisma/e2e.db prisma/e2e.db-journal
rm -rf prisma/e2e-attachments
npx prisma migrate deploy
npx tsx scripts/seed-demo.ts
exec npx next start -p "${PORT:-3456}"
