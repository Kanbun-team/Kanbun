import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { ActionError } from "@/lib/action-result";
import { fileSlug } from "@/lib/transfer/format";
import { audit } from "@/server/audit";
import { loadBoardAccess } from "@/server/board-access";
import { boardCardsCsv, exportBoard } from "@/server/transfer/export";
import { downloadHeaders, fail, statusOf } from "@/server/transfer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Board download: GET /api/boards/[id]/export?format=json|csv[&activity=1].
// Anyone who can open the board may export it (they can read all of it anyway).

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = (await auth())?.user;
  if (!user?.id) return fail("unauthorized", 401);
  try {
    await loadBoardAccess(id);
  } catch (err) {
    const code = err instanceof ActionError ? err.code : "unknown";
    return fail(code, statusOf(code));
  }
  const format = req.nextUrl.searchParams.get("format") === "csv" ? "csv" : "json";
  const activity = req.nextUrl.searchParams.get("activity") === "1";
  const data = await exportBoard(id, { activity: activity && format === "json" });
  if (!data) return fail("notFound", 404);
  const board = data.boards[0];

  await audit({
    action: "export.board",
    actor: { id: user.id, name: user.username },
    target: { type: "board", id, name: board.name },
    details: { format, activity },
  });

  const base = `kanbun-${fileSlug(board.name)}-${data.exportedAt.slice(0, 10)}`;
  if (format === "csv") {
    // The byte order mark makes Excel read the file as UTF-8.
    return new Response("﻿" + boardCardsCsv(data), {
      headers: downloadHeaders(`${base}.csv`, "text/csv; charset=utf-8"),
    });
  }
  return new Response(JSON.stringify(data, null, 2), {
    headers: downloadHeaders(`${base}.json`, "application/json; charset=utf-8"),
  });
}
