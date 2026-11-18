"use server";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db-local";
import { requireUser } from "@/auth";
import type { ActionResult } from "@/lib/action-result";
import { safeAction } from "./safe-action";
import { buildFtsQuery, MARK_END, MARK_START, MAX_QUERY_LENGTH, matchesTerms, searchTerms } from "@/lib/search-query";

export interface SearchBoardHit {
  id: string;
  name: string;
  color: string;
}

export interface SearchCardHit {
  id: string;
  boardId: string;
  boardName: string;
  columnName: string;
  title: string;
  /** Text around the match in the description or a comment, with matched
   * terms wrapped in MARK_START/MARK_END. Null when only the title matched. */
  snippet: string | null;
}

export interface SearchResults {
  boards: SearchBoardHit[];
  cards: SearchCardHit[];
}

const BOARD_LIMIT = 5;
const CARD_LIMIT = 20;

interface CardRow {
  id: string;
  boardId: string;
  boardName: string;
  columnName: string;
  title: string;
  descriptionSnippet: string | null;
  commentsSnippet: string | null;
}

// Cards and boards the current user can open: admins see every board, members
// only boards they belong to. Archived boards are left out, like in the board
// switcher.
export async function searchAction(query: string): Promise<ActionResult<SearchResults>> {
  return safeAction(async () => {
    const user = await requireUser();
    const input = typeof query === "string" ? query.slice(0, MAX_QUERY_LENGTH) : "";
    const terms = searchTerms(input);
    const match = buildFtsQuery(input);
    if (!match) return { boards: [], cards: [] };
    const isAdmin = user.role === "admin";

    const boardRows = await prisma.board.findMany({
      where: { archived: false, ...(isAdmin ? {} : { members: { some: { userId: user.id } } }) },
      select: { id: true, name: true, color: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
    const boards = boardRows.filter((b) => matchesTerms(b.name, terms)).slice(0, BOARD_LIMIT);

    const access = isAdmin
      ? Prisma.sql``
      : Prisma.sql`AND EXISTS (SELECT 1 FROM "BoardMember" m WHERE m."boardId" = b."id" AND m."userId" = ${user.id})`;

    // bm25 weights follow the column order: cardId, title, description,
    // comments, folded. A title match ranks above a description or comment.
    const rows = await prisma.$queryRaw<CardRow[]>`
      SELECT
        c."id" AS "id",
        b."id" AS "boardId",
        b."name" AS "boardName",
        col."name" AS "columnName",
        c."title" AS "title",
        snippet("CardSearch", 2, ${MARK_START}, ${MARK_END}, '…', 12) AS "descriptionSnippet",
        snippet("CardSearch", 3, ${MARK_START}, ${MARK_END}, '…', 12) AS "commentsSnippet"
      FROM "CardSearch" s
      JOIN "TaskCard" c ON c."id" = s."cardId"
      JOIN "BoardColumn" col ON col."id" = c."columnId"
      JOIN "Board" b ON b."id" = col."boardId"
      WHERE "CardSearch" MATCH ${match}
        AND b."archived" = 0
        ${access}
      ORDER BY bm25("CardSearch", 0.0, 10.0, 3.0, 2.0, 1.0)
      LIMIT ${CARD_LIMIT}
    `;

    const cards: SearchCardHit[] = rows.map((row) => ({
      id: row.id,
      boardId: row.boardId,
      boardName: row.boardName,
      columnName: row.columnName,
      title: row.title,
      snippet: pickSnippet(row),
    }));
    return { boards, cards };
  });
}

function pickSnippet(row: CardRow): string | null {
  for (const snippet of [row.descriptionSnippet, row.commentsSnippet]) {
    if (snippet && snippet.includes(MARK_START)) return snippet;
  }
  return null;
}
