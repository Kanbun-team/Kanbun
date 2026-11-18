// Which database Kanbun talks to, decided by DATABASE_URL at runtime.
//
// SQLite (file:...) is the default and needs nothing else. A postgres:// or
// postgresql:// URL selects PostgreSQL. The build generates a Prisma client for
// each (prisma/schema.prisma and the generated prisma/postgres/schema.prisma),
// so one build and one Docker image serve both. See docs/SCALING.md.
//
// Pure helpers only: no Prisma import here, so tests and scripts can use them.

export type DbProvider = "sqlite" | "postgres";

export function providerFromUrl(url: string | undefined | null): DbProvider {
  return url && /^postgres(ql)?:\/\//i.test(url.trim()) ? "postgres" : "sqlite";
}

export function dbProvider(): DbProvider {
  return providerFromUrl(process.env.DATABASE_URL);
}

export function isPostgres(): boolean {
  return dbProvider() === "postgres";
}

/**
 * A case-insensitive text filter for Prisma `where` clauses that behaves the
 * same on both databases. SQLite's LIKE already ignores ASCII case, and its
 * Prisma connector rejects `mode`; PostgreSQL compares case-sensitively unless
 * asked. Use it for every user-facing `contains`/`startsWith`/`endsWith`
 * (`equals` is case-sensitive on both, so it needs no helper):
 *
 *   where: { name: textFilter("contains", query) }
 */
export function textFilter(
  op: "contains" | "startsWith" | "endsWith",
  value: string,
  provider: DbProvider = dbProvider(),
): { contains?: string; startsWith?: string; endsWith?: string } {
  const filter = { [op]: value } as Record<string, string>;
  // The SQLite client's types have no `mode`, but the PostgreSQL client used at
  // runtime accepts it. The cast keeps one call site for both.
  if (provider === "postgres") filter.mode = "insensitive";
  return filter;
}
