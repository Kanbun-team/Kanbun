import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { t } from "@/lib/i18n";
import { createBoardAction } from "@/server/tasks-actions";

export const dynamic = "force-dynamic";

export default async function TasksIndexPage() {
  const session = await auth();
  const user = session!.user;
  const locale = await getLocale();
  const isAdmin = user.role === "admin";

  const boards = await prisma.board.findMany({
    where: isAdmin
      ? {}
      : { members: { some: { userId: user.id } } },
    orderBy: [{ archived: "asc" }, { updatedAt: "desc" }],
    include: {
      _count: { select: { columns: true, members: true } },
      members: {
        take: 6,
        include: { user: { select: { displayName: true, username: true, avatarUrl: true } } },
      },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("boardsTitle", locale)}</h1>
      </div>

      <form
        action={createBoardAction}
        className="surface border rounded-xl p-4 flex flex-col sm:flex-row gap-2 sm:items-end"
      >
        <label className="flex-1">
          <span className="text-sm opacity-80">{t("boardName", locale)}</span>
          <input name="name" required maxLength={120} className="mt-1" />
        </label>
        <label className="flex-1">
          <span className="text-sm opacity-80">{t("boardDescription", locale)}</span>
          <input name="description" maxLength={2000} className="mt-1" />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 font-medium transition shrink-0"
        >
          {t("boardCreate", locale)}
        </button>
      </form>

      {boards.length === 0 ? (
        <p className="opacity-70 text-sm">{t("boardsEmpty", locale)}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
          {boards.map((b) => (
            <li key={b.id} className="h-full">
              <Link
                href={`/tasks/${b.id}`}
                className="flex flex-col h-full min-h-[150px] surface border rounded-xl p-4 hover:border-brand-500 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold truncate">{b.name}</div>
                  {b.archived && (
                    <span className="text-xs opacity-60 shrink-0">{t("boardArchived", locale)}</span>
                  )}
                </div>
                <p className="text-sm opacity-70 mt-1 line-clamp-2 min-h-[2.5em]">
                  {b.description ?? ""}
                </p>
                <div className="flex-grow" />
                <div className="flex items-center justify-between mt-3 text-xs opacity-60">
                  <span>
                    {b._count.columns} cols / {b._count.members} {t("boardMembers", locale).toLowerCase()}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
