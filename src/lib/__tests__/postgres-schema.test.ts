import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs build script without type declarations
import * as gen from "../../../scripts/gen-postgres-schema.mjs";

const root = join(__dirname, "..", "..", "..");
const sqlite = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");

const { toPostgresSchema, modelBlocks, stripSearchStatements, BASELINE_NAME } = gen as {
  toPostgresSchema: (schema: string) => string;
  modelBlocks: (schema: string) => string[];
  stripSearchStatements: (sql: string) => string;
  BASELINE_NAME: string;
};

describe("Postgres schema generation", () => {
  const pg = toPostgresSchema(sqlite);

  it("swaps the provider and nothing else in the datasource", () => {
    expect(pg).toMatch(/datasource db \{\s*provider = "postgresql"\s*url\s*=\s*env\("DATABASE_URL"\)\s*\}/);
    expect(pg).not.toContain('"sqlite"');
  });

  it("generates the client next to the SQLite one", () => {
    expect(pg).toMatch(/generator client \{[^}]*output\s*=\s*"\.\.\/\.\.\/node_modules\/\.prisma\/client-postgres"/);
  });

  it("keeps every model identical", () => {
    const models = modelBlocks(sqlite);
    expect(models.length).toBeGreaterThan(20);
    expect(modelBlocks(pg)).toEqual(models);
  });

  it("is idempotent and rejects schemas it does not understand", () => {
    expect(toPostgresSchema(sqlite)).toBe(pg);
    expect(() => toPostgresSchema(pg)).toThrow(/sqlite/);
    expect(() => toPostgresSchema(sqlite.replace(/generator client \{/, 'generator client {\n  output = "x"'))).toThrow(
      /default output/,
    );
  });

  it("the committed prisma/postgres/schema.prisma is up to date (run npm run db:pg:generate-schema)", () => {
    expect(readFileSync(join(root, "prisma", "postgres", "schema.prisma"), "utf8")).toBe(pg);
  });

  it("the baseline creates every table (run npm run db:pg:baseline after schema changes)", () => {
    const baseline = readFileSync(join(root, "prisma", "postgres", "migrations", BASELINE_NAME, "migration.sql"), "utf8");
    for (const block of modelBlocks(sqlite)) {
      const name = block.match(/^model\s+(\w+)/)?.[1];
      if (name) expect(baseline, `CREATE TABLE "${name}"`).toContain(`CREATE TABLE "${name}"`);
    }
    expect(baseline).toContain('CREATE TABLE "CardSearch"');
  });

  it("strips statements for the hand-written search objects from new migrations", () => {
    const sql = [
      '-- DropForeignKey\nALTER TABLE "CardSearch" DROP CONSTRAINT "CardSearch_cardId_fkey";',
      '-- DropTable\nDROP TABLE "CardSearch";',
      '-- CreateTable\nCREATE TABLE "Webhook" ("id" TEXT NOT NULL);',
      "",
    ].join("\n");
    expect(stripSearchStatements(sql)).toBe('-- CreateTable\nCREATE TABLE "Webhook" ("id" TEXT NOT NULL);');
  });
});

describe("migrationFolderName", () => {
  const name = gen.migrationFolderName as (
    n: string,
    o: { now: Date; pgFolders: string[]; sqliteFolders: string[] }
  ) => string;
  const pgFolders = ["20261120000000_baseline", "20261123090000_webhook_outbox", "migration_lock.toml"];

  it("reuses the SQLite folder name when it comes after every PostgreSQL migration", () => {
    expect(
      name("add_things", { now: new Date("2026-01-01T00:00:00Z"), pgFolders, sqliteFolders: ["20261124100000_add_things"] })
    ).toBe("20261124100000_add_things");
  });

  it("never sorts before the latest PostgreSQL migration, even with a clock behind it", () => {
    expect(name("other", { now: new Date("2026-01-01T00:00:00Z"), pgFolders, sqliteFolders: [] })).toBe(
      "20261123090001_other"
    );
  });

  it("uses the clock when it is ahead", () => {
    expect(name("later", { now: new Date("2027-03-04T05:06:07Z"), pgFolders, sqliteFolders: [] })).toBe(
      "20270304050607_later"
    );
  });
});
