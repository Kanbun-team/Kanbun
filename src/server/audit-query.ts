import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db-local";

// Filters shared by the admin audit page and its CSV download. Dates are
// calendar days in UTC, both ends inclusive.

export const AUDIT_PAGE_SIZE = 50;

export interface AuditFilters {
  action: string;
  actor: string;
  from: string;
  to: string;
  page: number;
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function get(params: Params, key: string): string {
  const v = params instanceof URLSearchParams ? params.get(key) : params[key];
  return (Array.isArray(v) ? v[0] : v ?? "").trim().slice(0, 100);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseAuditFilters(params: Params): AuditFilters {
  const from = get(params, "from");
  const to = get(params, "to");
  const page = Number.parseInt(get(params, "page"), 10);
  return {
    action: get(params, "action"),
    actor: get(params, "actor"),
    from: DAY.test(from) && !Number.isNaN(Date.parse(from)) ? from : "",
    to: DAY.test(to) && !Number.isNaN(Date.parse(to)) ? to : "",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 100_000) : 1,
  };
}

export function auditWhere(f: AuditFilters): Prisma.AuditLogWhereInput {
  const createdAt: Prisma.DateTimeFilter = {};
  if (f.from) createdAt.gte = new Date(`${f.from}T00:00:00.000Z`);
  if (f.to) createdAt.lt = new Date(new Date(`${f.to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
  return {
    ...(f.action ? { action: f.action } : {}),
    ...(f.actor ? { actorName: f.actor } : {}),
    ...(f.from || f.to ? { createdAt } : {}),
  };
}

/** Values for the filter selects: every action and actor name in the log. */
export async function auditFilterOptions() {
  const [actions, actors] = await Promise.all([
    prisma.auditLog.groupBy({ by: ["action"], orderBy: { action: "asc" } }),
    prisma.auditLog.groupBy({
      by: ["actorName"],
      where: { actorName: { not: null } },
      orderBy: { actorName: "asc" },
      take: 500,
    }),
  ]);
  return {
    actions: actions.map((a) => a.action),
    actors: actors.map((a) => a.actorName).filter((n): n is string => !!n),
  };
}

/** Parses the stored details JSON; anything unexpected becomes an empty object. */
export function auditDetails(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
