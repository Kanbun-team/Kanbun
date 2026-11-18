#!/usr/bin/env node
// Generates the PostgreSQL schema and baseline migration from the SQLite
// schema, which stays the single source of truth.
//
//   node scripts/gen-postgres-schema.mjs            writes prisma/postgres/schema.prisma
//   node scripts/gen-postgres-schema.mjs --check    fails when that file is out of date
//   node scripts/gen-postgres-schema.mjs --check-db fails when the migrated database at
//        DATABASE_URL does not match the schema (a missing Postgres migration)
//   node scripts/gen-postgres-schema.mjs --baseline also rewrites the baseline migration
//   node scripts/gen-postgres-schema.mjs --migration <name>
//        adds a new Postgres migration (needs PG_SHADOW_DATABASE_URL, a scratch
//        database Prisma may wipe), see docs/SCALING.md
//
// Model content is copied verbatim. Only the datasource provider changes and
// the generator writes its client next to the SQLite one, so a single build
// carries both (see src/lib/db-provider.ts).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SQLITE_SCHEMA = join(ROOT, "prisma", "schema.prisma");
export const PG_DIR = join(ROOT, "prisma", "postgres");
export const PG_SCHEMA = join(PG_DIR, "schema.prisma");
export const PG_MIGRATIONS = join(PG_DIR, "migrations");
export const PG_SEARCH_SQL = join(PG_DIR, "search.sql");
/** v1.0 is the first release with Postgres, so everything up to it is one baseline. */
export const BASELINE_NAME = "20261120000000_baseline";
/** Where the Postgres client is generated, relative to prisma/postgres. */
export const PG_CLIENT_OUTPUT = "../../node_modules/.prisma/client-postgres";

const HEADER = `// GENERATED FILE, DO NOT EDIT. Source: prisma/schema.prisma.
// Regenerate with \`npm run db:pg:generate-schema\` (see docs/SCALING.md).
`;

/** Returns the body of the first `<kind> <name> { ... }` block, or null. */
function findBlock(schema, kind, name) {
  const re = new RegExp(`^${kind}\\s+${name}\\s*\\{[^}]*\\}`, "m");
  const m = schema.match(re);
  return m ? { text: m[0], index: m.index } : null;
}

/**
 * Turns the SQLite schema text into the Postgres schema text. Pure, so the
 * unit tests can check it without touching the disk.
 */
export function toPostgresSchema(sqlite) {
  const datasource = findBlock(sqlite, "datasource", "db");
  if (!datasource) throw new Error("schema.prisma has no `datasource db` block");
  if (!/provider\s*=\s*"sqlite"/.test(datasource.text)) {
    throw new Error('the datasource provider in schema.prisma must be "sqlite"');
  }
  const generator = findBlock(sqlite, "generator", "client");
  if (!generator) throw new Error("schema.prisma has no `generator client` block");
  if (/^\s*output\s*=/m.test(generator.text)) {
    throw new Error("the generator in schema.prisma must use the default output");
  }

  let out = sqlite.replace(
    datasource.text,
    datasource.text.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"'),
  );
  out = out.replace(
    generator.text,
    generator.text.replace(/\}\s*$/, `  output   = "${PG_CLIENT_OUTPUT}"\n}`),
  );
  return HEADER + "\n" + out;
}

/** The model, view and enum blocks of a schema, for comparing two schemas. */
export function modelBlocks(schema) {
  return schema.match(/^(model|enum|view)\s+\w+\s*\{[^}]*\}/gm) ?? [];
}

/** Drops statements that touch the hand-written search objects, which Prisma
 * does not model and would otherwise propose to drop in every new migration. */
export function stripSearchStatements(sql) {
  return sql
    .split(/;\s*\n/)
    .filter((stmt) => !/CardSearch|kanbun_search|kanbun_card_search/i.test(stmt))
    .join(";\n")
    .trim();
}

function prisma(args) {
  const bin = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
  return execFileSync(bin, args, {
    cwd: ROOT,
    env: { PRISMA_HIDE_UPDATE_MESSAGE: "1", ...process.env },
    encoding: "utf8",
  });
}

/** Fails when the PostgreSQL database at DATABASE_URL (migrated with
 * `node scripts/db.mjs deploy`) differs from prisma/postgres/schema.prisma,
 * ignoring the search objects. Catches a missing or stale Postgres migration. */
export function checkDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("postgres")) throw new Error("--check-db needs DATABASE_URL to point to PostgreSQL");
  const sql = stripSearchStatements(
    prisma(["migrate", "diff", "--from-url", url, "--to-schema-datamodel", PG_SCHEMA, "--script"]),
  );
  const statements = sql.split("\n").filter((line) => line.trim() && !line.startsWith("--"));
  return statements;
}

export function writeSchema() {
  mkdirSync(PG_DIR, { recursive: true });
  const next = toPostgresSchema(readFileSync(SQLITE_SCHEMA, "utf8"));
  writeFileSync(PG_SCHEMA, next);
  return next;
}

function writeLock() {
  mkdirSync(PG_MIGRATIONS, { recursive: true });
  writeFileSync(
    join(PG_MIGRATIONS, "migration_lock.toml"),
    '# Please do not edit this file manually\n# It should be added in your version-control system (i.e. Git)\nprovider = "postgresql"\n',
  );
}

export function writeBaseline() {
  writeSchema();
  const tables = prisma([
    "migrate", "diff",
    "--from-empty",
    "--to-schema-datamodel", PG_SCHEMA,
    "--script",
  ]);
  const search = readFileSync(PG_SEARCH_SQL, "utf8");
  // Only the baseline may exist: v1.0 is the first Postgres release.
  for (const entry of existsSync(PG_MIGRATIONS) ? readdirSync(PG_MIGRATIONS) : []) {
    if (entry !== BASELINE_NAME && entry !== "migration_lock.toml") {
      throw new Error(
        `prisma/postgres/migrations/${entry} exists: once a release has shipped, add migrations with --migration instead of rewriting the baseline`,
      );
    }
  }
  const dir = join(PG_MIGRATIONS, BASELINE_NAME);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "migration.sql"),
    `-- Kanbun PostgreSQL baseline. Generated by \`npm run db:pg:baseline\`.\n\n${tables.trim()}\n\n${search.trim()}\n`,
  );
  writeLock();
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export function writeMigration(name) {
  if (!/^[a-z0-9_]+$/.test(name ?? "")) throw new Error("migration name must be snake_case, e.g. add_webhooks");
  const shadow = process.env.PG_SHADOW_DATABASE_URL;
  if (!shadow?.startsWith("postgres")) {
    throw new Error("set PG_SHADOW_DATABASE_URL to a scratch PostgreSQL database (it is wiped)");
  }
  writeSchema();
  const sql = stripSearchStatements(
    prisma([
      "migrate", "diff",
      "--from-migrations", PG_MIGRATIONS,
      "--to-schema-datamodel", PG_SCHEMA,
      "--shadow-database-url", shadow,
      "--script",
    ]),
  );
  if (!sql || /^-- This is an empty migration/.test(sql)) {
    console.log("No schema changes: nothing to add.");
    return null;
  }
  const dir = join(PG_MIGRATIONS, `${timestamp()}_${name}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "migration.sql"), sql + "\n");
  return dir;
}

function main(argv) {
  if (argv.includes("--check-db")) {
    const pending = checkDatabase();
    if (pending.length > 0) {
      console.error("The PostgreSQL migrations do not match prisma/schema.prisma. Missing changes:\n");
      console.error(pending.join("\n"));
      console.error("\nRun `npm run db:pg:baseline` (before the first Postgres release) or `npm run db:pg:migration -- <name>`.");
      process.exit(1);
    }
    console.log("The PostgreSQL migrations match prisma/schema.prisma.");
    return;
  }
  if (argv.includes("--check")) {
    const expected = toPostgresSchema(readFileSync(SQLITE_SCHEMA, "utf8"));
    const actual = existsSync(PG_SCHEMA) ? readFileSync(PG_SCHEMA, "utf8") : "";
    if (expected !== actual) {
      console.error("prisma/postgres/schema.prisma is out of date: run `npm run db:pg:generate-schema`.");
      process.exit(1);
    }
    console.log("prisma/postgres/schema.prisma is up to date.");
    return;
  }
  const m = argv.indexOf("--migration");
  if (m !== -1) {
    const dir = writeMigration(argv[m + 1]);
    if (dir) console.log(`Wrote ${dir}/migration.sql`);
    return;
  }
  if (argv.includes("--baseline")) {
    writeBaseline();
    console.log(`Wrote prisma/postgres/schema.prisma and migrations/${BASELINE_NAME}.`);
    return;
  }
  writeSchema();
  console.log("Wrote prisma/postgres/schema.prisma.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
