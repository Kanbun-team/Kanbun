#!/usr/bin/env node
// Database commands that work for SQLite and PostgreSQL alike. The schema is
// picked from DATABASE_URL (postgres:// or postgresql:// selects PostgreSQL,
// anything else is SQLite), the same rule as src/lib/db-provider.ts.
//
//   node scripts/db.mjs generate   both Prisma clients (run by `npm run build`)
//   node scripts/db.mjs deploy     prisma migrate deploy on the right schema
//                                  (run by `npm start`)
//   node scripts/db.mjs reset      drop and recreate the database (tests only)
//   node scripts/db.mjs schema     print the schema path in use

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PG_SCHEMA, SQLITE_SCHEMA, writeSchema } from "./gen-postgres-schema.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRISMA = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");

export function isPostgresUrl(url) {
  return !!url && /^postgres(ql)?:\/\//i.test(url.trim());
}

function schemaForEnv() {
  return isPostgresUrl(process.env.DATABASE_URL) ? PG_SCHEMA : SQLITE_SCHEMA;
}

function prisma(args) {
  execFileSync(PRISMA, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { PRISMA_HIDE_UPDATE_MESSAGE: "1", ...process.env },
  });
}

const command = process.argv[2];
switch (command) {
  case "generate":
    // Keeps the Postgres schema in step with prisma/schema.prisma, so both
    // clients always have the same models.
    writeSchema();
    prisma(["generate", "--schema", SQLITE_SCHEMA]);
    prisma(["generate", "--schema", PG_SCHEMA]);
    break;
  case "deploy":
    prisma(["migrate", "deploy", "--schema", schemaForEnv()]);
    break;
  case "reset":
    prisma(["migrate", "reset", "--force", "--skip-seed", "--skip-generate", "--schema", schemaForEnv()]);
    break;
  case "schema":
    console.log(schemaForEnv());
    break;
  default:
    console.error("usage: node scripts/db.mjs generate|deploy|reset|schema");
    process.exit(2);
}
