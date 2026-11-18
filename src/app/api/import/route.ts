import { revalidatePath } from "next/cache";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { publishBoardList } from "@/lib/realtime";
import { EXPORT_VERSION, kanbunExportSchema, looksLikeKanbunExport, type ImportBoard } from "@/lib/transfer/format";
import { mapTrelloBoard, TrelloFormatError } from "@/lib/transfer/trello";
import { audit } from "@/server/audit";
import { importBoards } from "@/server/transfer/import";
import { fail, maxImportBytes, readTextLimited, sameOrigin } from "@/server/transfer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Import a board file as new boards owned by the signed-in user:
// POST /api/import with the file as the raw body. Trello board exports and
// Kanbun exports are told apart by content. A route handler (not a server
// action) because files may be up to IMPORT_MAX_MB; this path is left out of
// the proxy (src/proxy.ts) so the body is not buffered there.

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("forbidden", 403);
  const user = (await auth())?.user;
  if (!user?.id) return fail("unauthorized", 401);

  const max = maxImportBytes();
  const text = await readTextLimited(req, max);
  if (text === null) return fail("tooLarge", 413, { maxMb: Math.round(max / 1024 / 1024) });
  if (!text.trim()) return fail("empty", 400);

  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return fail("invalidJson", 400);
  }

  const locale = await getLocale();
  const originallyBy = (name: string, date: string) =>
    t("importOriginallyBy", locale).replace("{name}", name).replace("{date}", date);

  let boards: ImportBoard[];
  let source: "trello" | "kanbun";
  let skipped = { lists: 0, cards: 0 };
  if (looksLikeKanbunExport(raw)) {
    source = "kanbun";
    if ((raw as { version?: unknown }).version !== EXPORT_VERSION) return fail("unsupportedVersion", 400);
    const parsed = kanbunExportSchema.safeParse(raw);
    if (!parsed.success) {
      return fail("invalidExport", 400, {
        issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    boards = parsed.data.boards;
  } else {
    source = "trello";
    try {
      const mapped = mapTrelloBoard(raw, { originallyBy });
      // Re-validate through the Kanbun schema so both paths write the same shape.
      const parsed = kanbunExportSchema.safeParse({
        format: "kanbun-export",
        version: EXPORT_VERSION,
        kind: "board",
        exportedAt: new Date().toISOString(),
        boards: [mapped.board],
      });
      if (!parsed.success) {
        return fail("notTrello", 400, {
          issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
        });
      }
      boards = parsed.data.boards;
      skipped = { lists: mapped.stats.skippedLists, cards: mapped.stats.skippedCards };
    } catch (err) {
      if (err instanceof TrelloFormatError) return fail("notTrello", 400, { issues: err.issues });
      throw err;
    }
  }

  let results;
  try {
    results = await importBoards(boards, { id: user.id, username: user.username }, originallyBy);
  } catch (err) {
    console.error("[import]", err);
    return fail("unknown", 500);
  }

  for (const [i, r] of results.entries()) {
    await audit({
      action: "import.board",
      actor: { id: user.id, name: user.username },
      target: { type: "board", id: r.boardId, name: boards[i].name },
      details: { source, cards: r.stats.cards, columns: r.stats.columns, comments: r.stats.comments },
    });
  }
  revalidatePath("/tasks");
  publishBoardList();

  const total = results.reduce(
    (acc, r) => ({
      columns: acc.columns + r.stats.columns,
      cards: acc.cards + r.stats.cards,
      comments: acc.comments + r.stats.comments,
      checklistItems: acc.checklistItems + r.stats.checklistItems,
      tags: acc.tags + r.stats.tags,
    }),
    { columns: 0, cards: 0, comments: 0, checklistItems: 0, tags: 0 }
  );
  return Response.json({
    ok: true,
    source,
    boards: results.map((r, i) => ({ id: r.boardId, name: boards[i].name })),
    stats: total,
    skipped,
    unmatchedUsers: Array.from(new Set(results.flatMap((r) => r.stats.unmatchedUsers))).sort(),
  });
}
