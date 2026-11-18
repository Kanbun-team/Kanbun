import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { toCsv } from "@/lib/csv";
import { auditWhere, parseAuditFilters } from "@/server/audit-query";
import { downloadHeaders, fail } from "@/server/transfer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The audit log as CSV, with the filters of the admin audit page:
// GET /api/admin/audit/export?action=&actor=&from=&to=. Admins only.

const MAX_ROWS = 100_000;

export async function GET(req: NextRequest) {
  const user = (await auth())?.user;
  if (!user?.id) return fail("unauthorized", 401);
  if (user.role !== "admin") return fail("forbidden", 403);
  const where = auditWhere(parseAuditFilters(req.nextUrl.searchParams));
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_ROWS,
  });
  const csv = toCsv([
    ["time", "actor", "action", "targetType", "targetId", "targetName", "ip", "details"],
    ...rows.map((r) => [
      r.createdAt.toISOString(),
      r.actorName ?? "",
      r.action,
      r.targetType ?? "",
      r.targetId ?? "",
      r.targetName ?? "",
      r.ip ?? "",
      r.details,
    ]),
  ]);
  const day = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + csv, { headers: downloadHeaders(`kanbun-audit-${day}.csv`, "text/csv; charset=utf-8") });
}
