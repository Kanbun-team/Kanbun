import Link from "next/link";
import { cookies } from "next/headers";
import { requirePageUser } from "@/auth";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { RECENT_BOARDS_COOKIE, RECENT_BOARDS_SHOWN, parseRecentBoards } from "@/lib/recent-boards";
import BoardCard, { BOARD_GRID_CLASS, type BoardCardData } from "@/components/BoardCard";
import CategorizedBoards from "@/components/CategorizedBoards";
import CreateBoardModal from "@/components/CreateBoardModal";
import CreateCategoryModal from "@/components/CreateCategoryModal";

export const dynamic = "force-dynamic";

const userSelect = { id: true, username: true, displayName: true, avatarUrl: true } as const;

export default async function TasksIndexPage() {
  const user = await requirePageUser();
  const locale = await getLocale();
  const isAdmin = user.role === "admin";
  const recentIds = parseRecentBoards((await cookies()).get(RECENT_BOARDS_COOKIE)?.value);

  const [boardsRaw, otherUsers, categories, pins] = await Promise.all([
    prisma.board.findMany({
      where: isAdmin ? {} : { members: { some: { userId: user.id } } },
      orderBy: [{ archived: "asc" }, { position: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        archived: true,
        categoryId: true,
        position: true,
        columns: { orderBy: { position: "desc" }, select: { id: true } },
        members: {
          where: { user: { deactivatedAt: null } },
          orderBy: [{ addedAt: "asc" }, { userId: "asc" }],
          take: 4,
          select: { user: { select: userSelect } },
        },
        _count: { select: { members: { where: { user: { deactivatedAt: null } } } } },
      },
    }),
    prisma.user.findMany({
      where: { id: { not: user.id }, deactivatedAt: null },
      orderBy: [{ displayName: "asc" }, { username: "asc" }],
      select: userSelect,
    }),
    prisma.boardCategory.findMany({
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, color: true },
    }),
    prisma.boardPin.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { boardId: true },
    }),
  ]);

  // Card counts come from two grouped queries over every visible column, not
  // one query per board. The last column of a board counts as "done".
  const columnIds = boardsRaw.flatMap((b) => b.columns.map((c) => c.id));
  const doneColumnIds = new Set(boardsRaw.flatMap((b) => (b.columns[0] ? [b.columns[0].id] : [])));
  const openColumnIds = columnIds.filter((id) => !doneColumnIds.has(id));
  // Deadlines are calendar dates stored as UTC midnight (see lib/deadline.ts).
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  const [cardsPerColumn, overduePerColumn] = await Promise.all([
    columnIds.length
      ? prisma.taskCard.groupBy({ by: ["columnId"], where: { columnId: { in: columnIds } }, _count: { _all: true } })
      : [],
    openColumnIds.length
      ? prisma.taskCard.groupBy({
          by: ["columnId"],
          where: { columnId: { in: openColumnIds }, deadline: { lt: today } },
          _count: { _all: true },
        })
      : [],
  ]);
  const cardCount = new Map(cardsPerColumn.map((g) => [g.columnId, g._count._all]));
  const overdueCount = new Map(overduePerColumn.map((g) => [g.columnId, g._count._all]));
  const pinned = new Set(pins.map((p) => p.boardId));

  const boards: BoardCardData[] = boardsRaw.map((b) => {
    const total = b.columns.reduce((sum, c) => sum + (cardCount.get(c.id) ?? 0), 0);
    const done = b.columns[0] ? cardCount.get(b.columns[0].id) ?? 0 : 0;
    return {
      id: b.id,
      name: b.name,
      description: b.description,
      color: b.color,
      archived: b.archived,
      categoryId: b.categoryId,
      position: b.position,
      pinned: pinned.has(b.id),
      members: b.members.map((m) => m.user),
      membersCount: b._count.members,
      openCount: total - done,
      overdueCount: b.columns.reduce((sum, c) => sum + (overdueCount.get(c.id) ?? 0), 0),
      doneCount: done,
      totalCount: total,
    };
  });

  const byId = new Map(boards.map((b) => [b.id, b]));
  const pinnedBoards = pins.flatMap((p) => byId.get(p.boardId) ?? []);
  const recentBoards = recentIds
    .flatMap((id) => byId.get(id) ?? [])
    .slice(0, RECENT_BOARDS_SHOWN);

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-semibold">{t("boardsTitle", locale)}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <CreateCategoryModal locale={locale} />
          <CreateBoardModal users={otherUsers} categories={categories} locale={locale} />
        </div>
      </header>

      {boards.length === 0 && <p className="text-base text-ink-muted">{t("homeEmpty", locale)}</p>}

      {recentBoards.length > 0 && (
        <section aria-labelledby="home-recent" className="space-y-3">
          <h2 id="home-recent" className="text-md font-semibold px-1">
            {t("homeRecent", locale)}
          </h2>
          <ul className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {recentBoards.map((b) => (
              <li key={b.id} className="shrink-0">
                <Link
                  href={`/tasks/${b.id}`}
                  className="flex items-center gap-2 max-w-[16rem] h-9 rounded-card border border-line bg-surface px-3 text-base font-medium hover:border-line-strong transition-colors duration-[120ms]"
                >
                  <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: b.color }} />
                  <span className="truncate">{b.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pinnedBoards.length > 0 && (
        <section aria-labelledby="home-pinned" className="space-y-3">
          <header className="flex items-center gap-2 px-1 min-h-8">
            <h2 id="home-pinned" className="text-md font-semibold">
              {t("homePinned", locale)}
            </h2>
            <span className="text-sm text-ink-muted tabular-nums">{pinnedBoards.length}</span>
          </header>
          <ul className={BOARD_GRID_CLASS}>
            {pinnedBoards.map((b) => (
              <li key={b.id} className="h-full">
                <BoardCard board={b} locale={locale} muted={b.archived} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <CategorizedBoards boards={boards} categories={categories} users={otherUsers} locale={locale} />
    </div>
  );
}
