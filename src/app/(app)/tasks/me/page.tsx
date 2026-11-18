import { requirePageUser } from "@/auth";
import { prisma } from "@/lib/db-local";
import { getLocale } from "@/lib/get-locale";
import { formatDate, t, type DictKey } from "@/lib/i18n";
import Link from "next/link";
import { Clock, Inbox, ListChecks } from "lucide-react";
import { daysUntil, relativeDeadline } from "@/lib/deadline";
import { cn } from "@/lib/utils";
import CardFace from "@/components/board/CardFace";
import type { CardDTO } from "@/components/board/types";
import EmptyState from "@/components/ui/EmptyState";
import { buttonClass } from "@/components/ui/button";
import { titleMetadata } from "@/server/page-title";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return titleMetadata("myTasksTitle");
}

// Card links here are plain <a>, not <Link>: a soft navigation from /tasks/me
// is caught by the board's card-panel interception (/tasks/[id] matches "me")
// and ends on "Page not found". A full load opens the card page.

const DAY = 24 * 60 * 60 * 1000;
const PRIORITY_RANK: Record<string, number> = { critical: 3, high: 2, normal: 1, low: 0 };
const userSelect = { id: true, displayName: true, username: true, avatarUrl: true } as const;

type SectionKey = "overdue" | "today" | "upcoming" | "later" | "done";

const SECTIONS: { key: SectionKey; label: DictKey }[] = [
  { key: "overdue", label: "myWorkOverdue" },
  { key: "today", label: "myWorkToday" },
  { key: "upcoming", label: "myWorkUpcoming" },
  { key: "later", label: "myWorkLater" },
  { key: "done", label: "myWorkDone" },
];

interface Item {
  card: CardDTO;
  boardId: string;
  boardName: string;
  boardColor: string;
  columnName: string;
  /** For sorting "Done this week": when the card reached the last column. */
  doneAt: number;
}

export default async function MyWorkPage() {
  const user = await requirePageUser();
  const locale = await getLocale();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY);

  // Cards assigned to me on every board I can open (admins can open all
  // boards). Archived boards are left out: their work is parked.
  const cards = await prisma.taskCard.findMany({
    where: {
      assignees: { some: { userId: user.id } },
      column: {
        board: {
          archived: false,
          ...(user.role === "admin" ? {} : { members: { some: { userId: user.id } } }),
        },
      },
    },
    include: {
      column: {
        select: {
          id: true,
          name: true,
          board: {
            select: {
              id: true,
              name: true,
              color: true,
              columns: { orderBy: { position: "desc" }, take: 1, select: { id: true } },
            },
          },
        },
      },
      assignees: { include: { user: { select: userSelect } } },
      tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
      subtasks: { select: { done: true } },
      _count: { select: { comments: true, blockedBy: true, attachments: true } },
    },
  });

  // Open checklist items assigned to me, listed in their own group with a
  // link to the parent card. Soonest due first, undated last.
  const subtasks = await prisma.taskSubtask.findMany({
    where: {
      assigneeId: user.id,
      done: false,
      card: {
        column: {
          board: {
            archived: false,
            ...(user.role === "admin" ? {} : { members: { some: { userId: user.id } } }),
          },
        },
      },
    },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 200,
    select: {
      id: true,
      title: true,
      dueDate: true,
      card: { select: { id: true, title: true, column: { select: { board: { select: { id: true, name: true, color: true } } } } } },
    },
  });

  // "Done" means the card sits in the last column of its board. Such a card
  // is listed under "Done this week" only when it got there in the last 7
  // days: a move event into a column with that name, or (for cards created
  // straight in that column, which log no move) a creation date in the last
  // 7 days. Older done cards are not shown at all.
  const isDone = (c: (typeof cards)[number]) => c.column.board.columns[0]?.id === c.column.id;
  const doneCards = cards.filter(isDone);
  const moves = doneCards.length
    ? await prisma.taskCardMoveEvent.findMany({
        where: {
          boardId: { in: Array.from(new Set(doneCards.map((c) => c.column.board.id))) },
          cardId: { in: doneCards.map((c) => c.id) },
          createdAt: { gte: weekAgo },
        },
        select: { cardId: true, toColumnName: true, createdAt: true },
      })
    : [];
  const doneAt = new Map<string, number>();
  for (const c of doneCards) {
    const times = moves
      .filter((m) => m.cardId === c.id && m.toColumnName === c.column.name)
      .map((m) => m.createdAt.getTime());
    if (c.createdAt >= weekAgo) times.push(c.createdAt.getTime());
    if (times.length) doneAt.set(c.id, Math.max(...times));
  }

  const groups: Record<SectionKey, Item[]> = { overdue: [], today: [], upcoming: [], later: [], done: [] };
  for (const c of cards) {
    const item: Item = {
      boardId: c.column.board.id,
      boardName: c.column.board.name,
      boardColor: c.column.board.color,
      columnName: c.column.name,
      doneAt: doneAt.get(c.id) ?? 0,
      card: {
        id: c.id,
        title: c.title,
        priority: c.priority,
        coverColor: c.coverColor,
        deadline: c.deadline ? c.deadline.toISOString() : null,
        position: c.position,
        assignees: c.assignees.map((a) => a.user),
        tags: c.tags.map((tt) => tt.tag),
        subtasksTotal: c.subtasks.length,
        subtasksDone: c.subtasks.filter((s) => s.done).length,
        commentsCount: c._count.comments,
        blockedByCount: c._count.blockedBy,
        attachmentsCount: c._count.attachments,
      },
    };
    if (isDone(c)) {
      if (doneAt.has(c.id)) groups.done.push(item);
      continue;
    }
    const days = item.card.deadline ? daysUntil(item.card.deadline, now) : null;
    if (days === null || days > 7) groups.later.push(item);
    else if (days < 0) groups.overdue.push(item);
    else if (days === 0) groups.today.push(item);
    else groups.upcoming.push(item);
  }

  // Soonest deadline first (no deadline last), then higher priority.
  const byDeadline = (a: Item, b: Item) => {
    const da = a.card.deadline ? Date.parse(a.card.deadline) : Infinity;
    const db = b.card.deadline ? Date.parse(b.card.deadline) : Infinity;
    if (da !== db) return da < db ? -1 : 1;
    return (PRIORITY_RANK[b.card.priority] ?? 1) - (PRIORITY_RANK[a.card.priority] ?? 1);
  };
  for (const key of ["overdue", "today", "upcoming", "later"] as const) groups[key].sort(byDeadline);
  groups.done.sort((a, b) => b.doneAt - a.doneAt);

  const visible = SECTIONS.filter((s) => groups[s.key].length > 0);

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-semibold">{t("myTasksTitle", locale)}</h1>
      {visible.length === 0 && subtasks.length === 0 ? (
        <EmptyState
          icon={<Inbox size={20} />}
          title={t("myTasksEmptyTitle", locale)}
          action={
            <Link href="/tasks" className={buttonClass("primary", "md")}>
              {t("myTasksEmptyAction", locale)}
            </Link>
          }
        >
          {t("myTasksEmpty", locale)}
        </EmptyState>
      ) : (
        visible.map((section) => {
          const items = groups[section.key];
          const headingId = `my-work-${section.key}`;
          return (
            <section key={section.key} aria-labelledby={headingId} className="space-y-3">
              <header className="flex items-center gap-2 px-1">
                <h2 id={headingId} className="text-md font-semibold">
                  {t(section.label, locale)}
                </h2>
                <span className="text-sm text-ink-muted tabular-nums">{items.length}</span>
              </header>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => (
                  <li key={item.card.id} className="flex flex-col">
                    <a
                      href={`/tasks/${item.boardId}/cards/${item.card.id}`}
                      data-card-id={item.card.id}
                      className={cn(
                        "relative flex-1 flex flex-col overflow-hidden rounded-card bg-raised border border-line shadow-card px-3 pt-2.5 pb-2.5 hover:border-line-strong transition-colors duration-[120ms]",
                        item.card.coverColor && "pt-3.5"
                      )}
                    >
                      <span className="flex-1">
                        <CardFace card={item.card} locale={locale} />
                      </span>
                      <span className="mt-2.5 pt-2 border-t border-line flex items-center gap-1.5 min-w-0 text-sm text-ink-muted">
                        <span
                          aria-hidden="true"
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: item.boardColor }}
                        />
                        <span className="truncate">
                          {t("myWorkLocation", locale)
                            .replace("{board}", item.boardName)
                            .replace("{column}", item.columnName)}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      {subtasks.length > 0 && (
        <section aria-labelledby="my-work-subtasks" className="space-y-3">
          <header className="flex items-center gap-2 px-1">
            <h2 id="my-work-subtasks" className="text-md font-semibold">
              {t("myWorkSubtasks", locale)}
            </h2>
            <span className="text-sm text-ink-muted tabular-nums">{subtasks.length}</span>
          </header>
          <ul className="rounded-card bg-raised border border-line shadow-card divide-y divide-line">
            {subtasks.map((s) => {
              const board = s.card.column.board;
              const due = s.dueDate ? relativeDeadline(s.dueDate.toISOString(), locale, now) : null;
              return (
                <li key={s.id}>
                  <a
                    href={`/tasks/${board.id}/cards/${s.card.id}`}
                    data-subtask-id={s.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-ink/[0.03] outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                  >
                    <ListChecks size={16} aria-hidden className="text-ink-muted shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-base font-medium break-words">{s.title}</span>
                      <span className="flex items-center gap-1.5 min-w-0 text-sm text-ink-muted">
                        <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0" style={{ background: board.color }} />
                        <span className="truncate">
                          {t("myWorkSubtaskOn", locale).replace("{card}", s.card.title)}, {board.name}
                        </span>
                      </span>
                    </span>
                    {due && (
                      <span
                        title={formatDate(s.dueDate!, locale)}
                        className={cn(
                          "inline-flex items-center gap-1 text-sm tabular-nums shrink-0",
                          due.tone === "late" ? "text-danger font-medium" : due.tone === "soon" ? "text-warning font-medium" : "text-ink-muted"
                        )}
                      >
                        <Clock size={14} aria-hidden />
                        {due.tone === "late" && <span className="sr-only">{t("cardOverdue", locale)}: </span>}
                        {due.label}
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
