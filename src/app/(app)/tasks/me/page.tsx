import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { t, formatDate } from "@/lib/i18n";
import { priorityClass, priorityLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function MyTasksPage() {
  const session = await auth();
  const user = session!.user;
  const locale = await getLocale();

  const cards = await prisma.taskCard.findMany({
    where: { assignees: { some: { userId: user.id } } },
    orderBy: [{ priority: "desc" }, { deadline: "asc" }, { updatedAt: "desc" }],
    include: {
      column: { select: { name: true, boardId: true, board: { select: { name: true } } } },
      tags: { include: { tag: true } },
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("myTasksTitle", locale)}</h1>
      {cards.length === 0 ? (
        <p className="opacity-70 text-sm">{t("myTasksEmpty", locale)}</p>
      ) : (
        <ul className="space-y-2">
          {cards.map((c) => (
            <li key={c.id}>
              <Link
                href={`/tasks/${c.column.boardId}/cards/${c.id}`}
                className="block surface border rounded-lg p-3 hover:border-brand-500"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-medium">{c.title}</div>
                  <span className="text-xs opacity-60">
                    {c.column.board.name} / {c.column.name}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                  <span className={`rounded px-1.5 py-0.5 ${priorityClass(c.priority)}`}>
                    {priorityLabel(c.priority, locale)}
                  </span>
                  {c.deadline && <span>{formatDate(new Date(c.deadline), locale)}</span>}
                  {c.tags.map((tt) => (
                    <span
                      key={tt.tagId}
                      className="px-1.5 py-0.5 rounded font-semibold"
                      style={{ background: tt.tag.color + "33", color: tt.tag.color }}
                    >
                      {tt.tag.name}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
