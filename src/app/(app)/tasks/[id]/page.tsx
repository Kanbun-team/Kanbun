import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { loadBoardAccess, canManageBoard } from "@/server/board-access";
import Board from "@/components/board/Board";
import { BoardPresence } from "@/components/presence/Presence";
import WatchButton from "@/components/WatchButton";
import type { ColumnDTO, SavedFilterDTO } from "@/components/board/types";
import { parseFilters } from "@/lib/board-filters-schema";
import { boardTitle } from "@/server/page-title";
import BoardTitleKeeper from "@/components/board/BoardTitleKeeper";
import { staleCardDays } from "@/server/flow";
import { BarChart3 } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return boardTitle(id);
}

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let access;
  try {
    access = await loadBoardAccess(id);
  } catch {
    notFound();
  }
  const locale = await getLocale();

  const board = await prisma.board.findUnique({
    where: { id },
    include: {
      members: {
        where: { user: { deactivatedAt: null } },
        include: { user: { select: { id: true, displayName: true, username: true, avatarUrl: true } } },
      },
      tags: { orderBy: { position: "asc" }, select: { id: true, name: true, color: true } },
      watchers: { where: { userId: access.userId }, select: { userId: true } },
      // Only what the card face needs (see docs/PERFORMANCE.md).
      columns: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          position: true,
          wipLimit: true,
          cards: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              title: true,
              priority: true,
              coverColor: true,
              deadline: true,
              position: true,
              assignees: {
                select: { user: { select: { id: true, displayName: true, username: true, avatarUrl: true } } },
              },
              tags: { select: { tagId: true } },
              _count: { select: { subtasks: true, comments: true, blockedBy: true, attachments: true } },
            },
          },
        },
      },
    },
  });
  if (!board) notFound();
  // Cards in their column for longer than usual (a marker on the card face).
  // Optional: the board still renders without it.
  const stalePromise = staleCardDays(
    id,
    board.columns.flatMap((c) => c.cards.map((card) => ({ id: card.id, columnId: c.id })))
  ).catch((err: unknown) => {
    console.error("[board] card ages unavailable", err);
    return new Map<string, number>();
  });

  const canManage = canManageBoard(access);
  const savedRows = await prisma.savedFilter.findMany({
    where: { boardId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, filters: true, createdById: true },
  });
  const savedFilters: SavedFilterDTO[] = savedRows.flatMap((row) => {
    const filters = parseFilters(row.filters);
    return filters
      ? [{ id: row.id, name: row.name, filters, canDelete: canManage || row.createdById === access.userId }]
      : [];
  });

  const templates = await prisma.cardTemplate.findMany({
    where: { boardId: id },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // Checklist progress for every card in one grouped query.
  const doneRows = await prisma.taskSubtask.groupBy({
    by: ["cardId"],
    where: { done: true, card: { column: { boardId: id } } },
    _count: { _all: true },
  });
  const subtasksDone = new Map(doneRows.map((r) => [r.cardId, r._count._all]));
  const stale = await stalePromise;

  // One object per person and per tag, shared by every card that uses it, so
  // the serialized page (and every live refresh) does not repeat them.
  const tagById = new Map(board.tags.map((tg) => [tg.id, { id: tg.id, name: tg.name, color: tg.color }]));
  const people = new Map<string, { id: string; displayName: string | null; username: string; avatarUrl: string | null }>();
  const person = (u: { id: string; displayName: string | null; username: string; avatarUrl: string | null }) => {
    let p = people.get(u.id);
    if (!p) people.set(u.id, (p = { id: u.id, displayName: u.displayName, username: u.username, avatarUrl: u.avatarUrl }));
    return p;
  };

  // Lets the board tell this data apart from a newer offline snapshot.
  const renderedAt = new Date().toISOString();

  const dto: ColumnDTO[] = board.columns.map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position,
    wipLimit: c.wipLimit,
    cards: c.cards.map((card) => ({
      id: card.id,
      title: card.title,
      priority: card.priority,
      coverColor: card.coverColor,
      deadline: card.deadline ? card.deadline.toISOString() : null,
      position: card.position,
      assignees: card.assignees.map((a) => person(a.user)),
      tags: card.tags.flatMap((tt) => tagById.get(tt.tagId) ?? []),
      subtasksTotal: card._count.subtasks,
      subtasksDone: subtasksDone.get(card.id) ?? 0,
      commentsCount: card._count.comments,
      blockedByCount: card._count.blockedBy,
      attachmentsCount: card._count.attachments,
      ...(stale.has(card.id) ? { staleDays: stale.get(card.id) } : {}),
    })),
  }));

  return (
    <div className="space-y-4" data-wide>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <span
              aria-hidden="true"
              className="w-3 h-3 rounded-full shrink-0"
              style={{ background: board.color }}
            />
            {board.name}
          </h1>
          {board.description && (
            <p className="text-sm text-ink-muted">{board.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <BoardTitleKeeper boardPath={`/tasks/${board.id}`} title={`${board.name} · Kanbun`} />
          <BoardPresence boardId={board.id} currentUserId={access.userId} locale={locale} />
          {board.archived && (
            <span className="px-2 py-0.5 rounded-control bg-ink/5 text-ink-muted">
              {t("boardArchived", locale)}
            </span>
          )}
          <WatchButton kind="board" id={board.id} watching={board.watchers.length > 0} />
          <Link
            href={`/tasks/${board.id}/insights`}
            className="inline-flex items-center gap-1.5 rounded-control px-3 py-1 hover:bg-ink/5"
          >
            <BarChart3 size={16} aria-hidden />
            {t("insightsTitle", locale)}
          </Link>
          {canManageBoard(access) && (
            <Link
              href={`/tasks/${board.id}/settings`}
              className="rounded-control px-3 py-1 hover:bg-ink/5"
            >
              {t("boardSettings", locale)}
            </Link>
          )}
        </div>
      </div>
      <Board
        boardId={board.id}
        columns={dto}
        locale={locale}
        canManage={canManageBoard(access)}
        currentUserId={access.userId}
        members={board.members.map((m) => person(m.user))}
        boardTags={[...tagById.values()]}
        savedFilters={savedFilters}
        templates={templates}
        renderedAt={renderedAt}
      />
    </div>
  );
}
