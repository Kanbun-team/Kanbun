import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { loadBoardAccess, canManageBoard } from "@/server/board-access";
import TaskBoard, { type ColumnDTO } from "@/components/TaskBoard";

export const dynamic = "force-dynamic";

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
      columns: {
        orderBy: { position: "asc" },
        include: {
          cards: {
            orderBy: { position: "asc" },
            include: {
              assignees: {
                include: {
                  user: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
                },
              },
              tags: { include: { tag: true } },
              subtasks: { select: { done: true } },
              _count: { select: { comments: true, blockedBy: true } },
            },
          },
        },
      },
    },
  });
  if (!board) notFound();

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
      assignees: card.assignees.map((a) => ({
        id: a.user.id,
        displayName: a.user.displayName,
        username: a.user.username,
        avatarUrl: a.user.avatarUrl,
      })),
      tags: card.tags.map((tt) => ({
        id: tt.tag.id,
        name: tt.tag.name,
        color: tt.tag.color,
      })),
      subtasksTotal: card.subtasks.length,
      subtasksDone: card.subtasks.filter((s) => s.done).length,
      commentsCount: card._count.comments,
      blockedByCount: card._count.blockedBy,
    })),
  }));

  return (
    <div className="space-y-4">
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
            <p className="text-sm opacity-70">{board.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          {board.archived && (
            <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800">
              {t("boardArchived", locale)}
            </span>
          )}
          {canManageBoard(access) && (
            <Link
              href={`/tasks/${board.id}/settings`}
              className="rounded-md px-3 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t("boardSettings", locale)}
            </Link>
          )}
        </div>
      </div>
      <TaskBoard
        boardId={board.id}
        columns={dto}
        locale={locale}
        canManage={canManageBoard(access)}
        currentUserId={access.userId}
      />
    </div>
  );
}
