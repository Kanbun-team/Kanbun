import { Prisma as SqlitePrisma, PrismaClient } from "@prisma/client";
import { dbProvider } from "./db-provider";

// One build carries two generated Prisma clients: the default one for SQLite
// (prisma/schema.prisma, in node_modules/.prisma/client) and one for
// PostgreSQL (prisma/postgres/schema.prisma, in
// node_modules/.prisma/client-postgres). DATABASE_URL picks one at startup.
// Both expose the same models, so the SQLite types describe either at compile
// time. next.config.mjs keeps the PostgreSQL client external (loaded by Node,
// not bundled).

type ClientModule = { PrismaClient: typeof PrismaClient; Prisma: typeof SqlitePrisma };

function loadClientModule(): ClientModule {
  if (dbProvider() !== "postgres") return { PrismaClient, Prisma: SqlitePrisma };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(".prisma/client-postgres") as ClientModule;
  } catch (err) {
    throw new Error(
      "DATABASE_URL points to PostgreSQL but the PostgreSQL Prisma client is missing. Run `npm run build` (or `npm run db:generate`).",
      { cause: err },
    );
  }
}

const clientModule = loadClientModule();

/** The Prisma namespace of the active client. Use its `sql`/`empty`/`join`
 * helpers for raw queries: fragments from another client's namespace are not
 * recognised as SQL and would be sent as parameters. */
export const DbPrisma: typeof SqlitePrisma = clientModule.Prisma;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new clientModule.PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** True for a Prisma "known request" error (unique violation, missing row...)
 * from whichever client is active. */
export function isKnownRequestError(err: unknown): err is SqlitePrisma.PrismaClientKnownRequestError {
  return (
    err instanceof SqlitePrisma.PrismaClientKnownRequestError ||
    err instanceof clientModule.Prisma.PrismaClientKnownRequestError
  );
}
