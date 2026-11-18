import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { ActionError } from "@/lib/action-result";
import { prisma } from "@/lib/db-local";
import { parseCsv } from "@/lib/csv";
import { publishBoard } from "@/lib/realtime";
import { CSV_FIELDS, MAX_CSV_ROWS, planCsvImport } from "@/lib/transfer/csv-import";
import { audit } from "@/server/audit";
import { canManageBoard, loadBoardAccess } from "@/server/board-access";
import { writeCsvPlan } from "@/server/transfer/import";
import { fail, maxImportBytes, readTextLimited, sameOrigin, statusOf } from "@/server/transfer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CSV import into an existing board: POST /api/import/csv?boardId=... with a
// JSON body { csv, delimiter, mapping }. The browser shows the same plan as a
// preview first (src/lib/transfer/csv-import.ts); here it is computed again
// from the raw file, so nothing the client claims about rows is trusted.

const bodySchema = z.object({
  csv: z.string(),
  delimiter: z.enum([",", ";", "\t"]),
  mapping: z.object(
    Object.fromEntries(CSV_FIELDS.map((f) => [f, z.number().int().min(0).max(500).nullable()])) as Record<
      (typeof CSV_FIELDS)[number],
      z.ZodNullable<z.ZodNumber>
    >
  ),
});

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("forbidden", 403);
  const user = (await auth())?.user;
  if (!user?.id) return fail("unauthorized", 401);
  const boardId = req.nextUrl.searchParams.get("boardId") ?? "";
  try {
    const access = await loadBoardAccess(boardId);
    if (!canManageBoard(access)) return fail("forbidden", 403);
  } catch (err) {
    const code = err instanceof ActionError ? err.code : "unknown";
    return fail(code, statusOf(code));
  }

  // JSON escaping can grow the text a little; allow some headroom over the file limit.
  const max = maxImportBytes();
  const text = await readTextLimited(req, Math.round(max * 1.2));
  if (text === null) return fail("tooLarge", 413, { maxMb: Math.round(max / 1024 / 1024) });
  let body;
  try {
    body = bodySchema.parse(JSON.parse(text));
  } catch {
    return fail("invalid", 400);
  }
  if (body.mapping.title === null) return fail("noTitleColumn", 400);

  const [, ...rows] = parseCsv(body.csv, body.delimiter);
  if (rows.length === 0) return fail("empty", 400);
  if (rows.length > MAX_CSV_ROWS) return fail("tooManyRows", 400, { max: MAX_CSV_ROWS });

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      name: true,
      columns: { orderBy: { position: "asc" }, select: { name: true } },
      tags: { select: { name: true } },
      members: { where: { user: { deactivatedAt: null } }, select: { user: { select: { username: true } } } },
    },
  });
  if (!board) return fail("notFound", 404);
  const plan = planCsvImport(rows, body.mapping, {
    columns: board.columns.map((c) => c.name),
    tags: board.tags.map((t) => t.name),
    members: board.members.map((m) => m.user.username),
  });
  if (plan.cards.length === 0) return fail("noValidRows", 400);

  let result;
  try {
    result = await writeCsvPlan(boardId, plan, { id: user.id, username: user.username });
  } catch (err) {
    console.error("[import csv]", err);
    return fail("unknown", 500);
  }
  await audit({
    action: "import.csv",
    actor: { id: user.id, name: user.username },
    target: { type: "board", id: boardId, name: board.name },
    details: { cards: result.cards, skippedRows: plan.errors.length, newColumns: result.newColumns, newTags: result.newTags },
  });
  revalidatePath(`/tasks/${boardId}`);
  publishBoard(boardId);
  return Response.json({ ok: true, ...result, skippedRows: plan.errors.length, warnings: plan.warnings.length });
}
