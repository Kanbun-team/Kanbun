import Link from "next/link";
import { requirePageUser } from "@/auth";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { t, formatDate } from "@/lib/i18n";
import { priorityClass, priorityLabel } from "@/lib/labels";
import TagChip from "@/components/ui/TagChip";

export const dynamic = "force-dynamic";

export default async function MyTasksPage() {
  const user = await requirePageUser();
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
        <p className="text-ink-muted text-sm">{t("myTasksEmpty", locale)}</p>
      ) : (
        <ul className="space-y-2">
          {cards.map((c) => (
            <li key={c.id}>
              <Link
                href={`/tasks/${c.column.boardId}/cards/${c.id}`}
                className="block bg-surface border border-line rounded-card shadow-card p-3 hover:border-accent"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-medium">{c.title}</div>
                  <span className="text-xs text-ink-muted">
                    {c.column.board.name} / {c.column.name}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                  <span className="inline-flex items-center gap-1.5 text-ink-muted">
                    <span aria-hidden="true" className={`w-2 h-2 rounded-full ${priorityClass(c.priority)}`} />
                    {priorityLabel(c.priority, locale)}
                  </span>
                  {c.deadline && <span className="text-ink-muted">{formatDate(new Date(c.deadline), locale)}</span>}
                  {c.tags.map((tt) => (
                    <TagChip key={tt.tagId} name={tt.tag.name} color={tt.tag.color} />
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
