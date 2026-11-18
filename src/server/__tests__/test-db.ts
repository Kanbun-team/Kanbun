import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * A throwaway SQLite database with every migration applied, for tests of
 * server logic that needs real queries and transactions.
 */
export function createTestDb(): { db: PrismaClient; cleanup: () => Promise<void> } {
  const dir = mkdtempSync(join(tmpdir(), "kanbun-test-"));
  const url = `file:${join(dir, "test.db")}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore",
  });
  const db = new PrismaClient({ datasources: { db: { url } } });
  return {
    db,
    cleanup: async () => {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
