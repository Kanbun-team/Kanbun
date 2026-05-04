import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import CategorizedBoards from "@/components/CategorizedBoards";
import CreateCategoryModal from "@/components/CreateCategoryModal";

export const dynamic = "force-dynamic";

export default async function TasksIndexPage() {
  const session = await auth();
  const user = session!.user;
  const locale = await getLocale();
  const isAdmin = user.role === "admin";

  const [boardsRaw, otherUsers, categories] = await Promise.all([
    prisma.board.findMany({
      where: isAdmin ? {} : { members: { some: { userId: user.id } } },
      orderBy: [{ archived: "asc" }, { position: "asc" }, { updatedAt: "desc" }],
      include: { _count: { select: { columns: true, members: true } } },
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

  const boards = boardsRaw.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    color: b.color,
    archived: b.archived,
    columnsCount: b._count.columns,
    membersCount: b._count.members,
    categoryId: b.categoryId,
    position: b.position,
  }));

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">{t("boardsTitle", locale)}</h1>

      <CategorizedBoards
        boards={boards}
        categories={categories}
        users={otherUsers}
        locale={locale}
      />

      <div className="pt-2">
        <CreateCategoryModal locale={locale} />
      </div>
    </div>
  );
}
