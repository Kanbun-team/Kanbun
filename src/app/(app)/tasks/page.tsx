import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import BoardCard, { type BoardCardData } from "@/components/BoardCard";
import CreateBoardModal from "@/components/CreateBoardModal";
import CreateCategoryModal from "@/components/CreateCategoryModal";

export const dynamic = "force-dynamic";

export default async function TasksIndexPage() {
  const session = await auth();
  const user = session!.user;
  const locale = await getLocale();
  const isAdmin = user.role === "admin";

  const [boardsRaw, otherUsers, categories] = await Promise.all([
    prisma.board.findMany({
      where: isAdmin
        ? {}
        : { members: { some: { userId: user.id } } },
      orderBy: [{ archived: "asc" }, { updatedAt: "desc" }],
      include: {
        _count: { select: { columns: true, members: true } },
      },
    }),
    prisma.user.findMany({
      where: { id: { not: user.id } },
      orderBy: [{ displayName: "asc" }, { username: "asc" }],
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    }),
    prisma.boardCategory.findMany({
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, color: true },
    }),
  ]);

  type Board = BoardCardData & { categoryId: string | null };
  const boards: Board[] = boardsRaw.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    color: b.color,
    archived: b.archived,
    columnsCount: b._count.columns,
    membersCount: b._count.members,
    categoryId: b.categoryId,
  }));

  const general = boards.filter((b) => !b.categoryId);
  const byCategory = new Map<string, Board[]>();
  for (const cat of categories) byCategory.set(cat.id, []);
  for (const b of boards) {
    if (b.categoryId && byCategory.has(b.categoryId)) {
      byCategory.get(b.categoryId)!.push(b);
    }
  }

  const gridClass = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr";

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">{t("boardsTitle", locale)}</h1>

      <ul className={gridClass}>
        {general.map((b) => (
          <li key={b.id} className="h-full">
            <BoardCard board={b} locale={locale} />
          </li>
        ))}
        <li className="h-full">
          <CreateBoardModal
            users={otherUsers}
            categories={categories}
            defaultCategoryId={null}
            locale={locale}
            variant="card"
          />
        </li>
      </ul>

      {categories.map((cat) => {
        const list = byCategory.get(cat.id) ?? [];
        return (
          <section key={cat.id} className="space-y-3">
            <header className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: cat.color }}
              />
              <h2 className="text-sm font-semibold uppercase tracking-wide opacity-80">
                {cat.name}
              </h2>
              <span className="text-xs opacity-50">{list.length}</span>
            </header>
            <ul className={gridClass}>
              {list.map((b) => (
                <li key={b.id} className="h-full">
                  <BoardCard board={b} locale={locale} />
                </li>
              ))}
              <li className="h-full">
                <CreateBoardModal
                  users={otherUsers}
                  categories={categories}
                  defaultCategoryId={cat.id}
                  locale={locale}
                  variant="card"
                />
              </li>
            </ul>
          </section>
        );
      })}

      <div className="pt-2">
        <CreateCategoryModal locale={locale} />
      </div>
    </div>
  );
}
