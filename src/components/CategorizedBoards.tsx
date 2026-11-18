"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import BoardCard, { BOARD_GRID_CLASS, type BoardCardData } from "./BoardCard";
import CreateBoardModal from "./CreateBoardModal";
import { moveBoardAction } from "@/server/tasks-actions";
import { ChevronRight } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useSyncedState } from "@/lib/use-synced-state";

interface UserOption {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
  color: string;
}

type Board = BoardCardData;

interface Props {
  boards: Board[];
  categories: CategoryOption[];
  users: UserOption[];
  locale: Locale;
}

const GRID_CLASS = BOARD_GRID_CLASS;

function reorder(
  boards: Board[],
  movedId: string,
  toCategoryId: string | null,
  position: number
): Board[] {
  const targetIds = boards
    .filter((b) => b.id !== movedId && b.categoryId === toCategoryId)
    .sort((a, b) => a.position - b.position)
    .map((b) => b.id);
  const bounded = Math.max(0, Math.min(position, targetIds.length));
  const newOrder = [...targetIds.slice(0, bounded), movedId, ...targetIds.slice(bounded)];
  const newPos = new Map<string, number>();
  newOrder.forEach((id, idx) => newPos.set(id, idx));

  return boards.map((b) => {
    if (b.id === movedId) {
      return { ...b, categoryId: toCategoryId, position: newPos.get(b.id) ?? 0 };
    }
    if (b.categoryId === toCategoryId && newPos.has(b.id)) {
      return { ...b, position: newPos.get(b.id) ?? b.position };
    }
    return b;
  });
}

interface DragOver {
  categoryId: string | null;
  // Which board the cursor is over, and which side. Both are visual hints.
  hoverBoardId: string | null;
  hoverSide: "left" | "right" | null;
  // The position in the FULL (unfiltered) list of this category where the
  // dragged board would be inserted. Translated to filtered position at drop.
  fullIndex: number;
}

export default function CategorizedBoards({ boards: initial, categories, users, locale }: Props) {
  const [boards, setBoards] = useSyncedState<Board[]>(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<DragOver | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Live updates for the boards grid: reordering, creating, archiving, or
  // renaming a board on one client pushes an SSE event to the others.
  useEffect(() => {
    const source = new EventSource("/api/boards/events");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    source.addEventListener("board", refresh);
    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [router]);

  const draggedBoard = useMemo(
    () => (dragId ? boards.find((b) => b.id === dragId) ?? null : null),
    [boards, dragId]
  );

  // Archived boards keep their category and position (the server orders
  // them together with active ones), but they are listed in their own
  // collapsed section instead of the draggable grids.
  const sections = useMemo(() => {
    const active = boards.filter((b) => !b.archived);
    const general = active
      .filter((b) => !b.categoryId || !categories.some((c) => c.id === b.categoryId))
      .sort((a, b) => a.position - b.position);
    const byCat = new Map<string, Board[]>();
    for (const cat of categories) byCat.set(cat.id, []);
    for (const b of active) {
      if (b.categoryId && byCat.has(b.categoryId)) {
        byCat.get(b.categoryId)!.push(b);
      }
    }
    for (const [k, list] of byCat) {
      byCat.set(k, list.sort((a, b) => a.position - b.position));
    }
    const archived = boards.filter((b) => b.archived);
    return { general, byCat, archived };
  }, [boards, categories]);

  function commitMove(boardId: string, toCategoryId: string | null, position: number) {
    setBoards((prev) => reorder(prev, boardId, toCategoryId, position));
    setDragId(null);
    setDragOver(null);
    startTransition(async () => {
      try {
        await moveBoardAction({ boardId, toCategoryId, position });
      } finally {
        router.refresh();
      }
    });
  }

  /**
   * Translate a "full-list insertion index" (what we track during hover) into
   * a "filtered insertion index" (what the server expects, since it filters
   * the source out before reordering). If the source is in the same category
   * AND its position is before fullIndex, we subtract 1.
   */
  function toFilteredIndex(fullIndex: number, list: Board[], sourceId: string): number {
    const sourceIndex = list.findIndex((b) => b.id === sourceId);
    if (sourceIndex < 0) return fullIndex;
    return sourceIndex < fullIndex ? fullIndex - 1 : fullIndex;
  }

  function commitFromHover(categoryId: string | null, list: Board[]) {
    if (!dragId) return;
    const fullIdx =
      dragOver?.categoryId === categoryId ? dragOver.fullIndex : list.length;
    const filteredIdx = toFilteredIndex(fullIdx, list, dragId);
    // The server counts every board in the category, archived ones included,
    // so insert before the same neighbour in that complete list.
    const before = list.filter((b) => b.id !== dragId)[filteredIdx];
    const all = boards
      .filter((b) => b.categoryId === categoryId && b.id !== dragId)
      .sort((a, b) => a.position - b.position);
    const position = before ? all.findIndex((b) => b.id === before.id) : all.length;
    commitMove(dragId, categoryId, position < 0 ? all.length : position);
  }

  function renderGrid(list: Board[], categoryId: string | null) {
    const isTarget = dragOver?.categoryId === categoryId;
    const indicatorColor = draggedBoard?.color ?? "#2563eb";

    return (
      <ul
        className={cn(GRID_CLASS, dragId && "select-none")}
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
          // Default: when hovering empty grid area, indicator goes after the
          // last card. Per-card handlers update this if cursor is over them.
          if (
            !isTarget ||
            dragOver?.fullIndex !== list.length ||
            dragOver?.hoverBoardId !== null
          ) {
            setDragOver({
              categoryId,
              hoverBoardId: null,
              hoverSide: null,
              fullIndex: list.length,
            });
          }
        }}
        onDrop={(e) => {
          if (!dragId) return;
          e.preventDefault();
          commitFromHover(categoryId, list);
        }}
      >
        {list.map((b, i) => {
          const isSource = b.id === dragId;
          const showLeftBar =
            isTarget &&
            dragOver?.hoverBoardId === b.id &&
            dragOver?.hoverSide === "left";
          const showRightBar =
            isTarget &&
            dragOver?.hoverBoardId === b.id &&
            dragOver?.hoverSide === "right";
          return (
            <li
              key={b.id}
              className={cn(
                "relative h-full transition-[opacity,transform] duration-200",
                "cursor-grab active:cursor-grabbing",
                isSource && "opacity-30 scale-[0.98]"
              )}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", b.id);
                // Defer state update so the browser captures the original
                // (full opacity) card as the drag image.
                setTimeout(() => setDragId(b.id), 0);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDragOver(null);
              }}
              onDragOver={(e) => {
                if (!dragId || dragId === b.id) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const isRight = e.clientX - rect.left > rect.width / 2;
                const side: "left" | "right" = isRight ? "right" : "left";
                const fullIndex = isRight ? i + 1 : i;
                if (
                  dragOver?.categoryId !== categoryId ||
                  dragOver.hoverBoardId !== b.id ||
                  dragOver.hoverSide !== side ||
                  dragOver.fullIndex !== fullIndex
                ) {
                  setDragOver({
                    categoryId,
                    hoverBoardId: b.id,
                    hoverSide: side,
                    fullIndex,
                  });
                }
              }}
              onDrop={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.stopPropagation();
                commitFromHover(categoryId, list);
              }}
            >
              <BoardCard board={b} locale={locale} />
              {/* Insertion bars; absolute, no layout impact */}
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute -left-2 top-1 bottom-1 w-1 rounded-full transition-opacity duration-150",
                  showLeftBar ? "opacity-100" : "opacity-0"
                )}
                style={{
                  background: indicatorColor,
                  boxShadow: showLeftBar ? `0 0 12px ${indicatorColor}` : undefined,
                }}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute -right-2 top-1 bottom-1 w-1 rounded-full transition-opacity duration-150",
                  showRightBar ? "opacity-100" : "opacity-0"
                )}
                style={{
                  background: indicatorColor,
                  boxShadow: showRightBar ? `0 0 12px ${indicatorColor}` : undefined,
                }}
              />
            </li>
          );
        })}
        {list.length === 0 && (
          <li className="col-span-full rounded-panel border border-dashed border-line-strong px-4 py-5 text-sm text-ink-muted text-center">
            {t("homeCategoryEmpty", locale)}
          </li>
        )}
      </ul>
    );
  }

  const showGeneral = sections.general.length > 0 || (dragId !== null && categories.length > 0);

  return (
    <>
      {categories.map((cat) => {
        const list = sections.byCat.get(cat.id) ?? [];
        const isTargetEmpty =
          dragId !== null &&
          dragOver?.categoryId === cat.id &&
          list.filter((b) => b.id !== dragId).length === 0;
        const headingId = `category-${cat.id}`;
        return (
          <section
            key={cat.id}
            aria-labelledby={headingId}
            className="space-y-3 rounded-panel transition-colors duration-150"
            style={
              isTargetEmpty
                ? { boxShadow: `inset 0 0 0 2px ${draggedBoard?.color ?? "#2563eb"}` }
                : undefined
            }
          >
            <header className="flex items-center gap-2 px-1 min-h-8">
              <span
                aria-hidden="true"
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: cat.color }}
              />
              <h2 id={headingId} className="text-md font-semibold">
                {cat.name}
              </h2>
              <span className="text-sm text-ink-muted tabular-nums">{list.length}</span>
              <span className="ml-auto">
                <CreateBoardModal
                  users={users}
                  categories={categories}
                  defaultCategoryId={cat.id}
                  locale={locale}
                  variant="inline"
                  inlineLabel={t("boardNewIn", locale).replace("{category}", cat.name)}
                />
              </span>
            </header>
            {renderGrid(list, cat.id)}
          </section>
        );
      })}

      {showGeneral && (
        <section aria-labelledby={categories.length > 0 ? "category-none" : undefined} className="space-y-3">
          {categories.length > 0 && (
            <header className="flex items-center gap-2 px-1 min-h-8">
              <h2 id="category-none" className="text-md font-semibold">
                {t("homeOtherBoards", locale)}
              </h2>
              <span className="text-sm text-ink-muted tabular-nums">{sections.general.length}</span>
            </header>
          )}
          {renderGrid(sections.general, null)}
        </section>
      )}

      {sections.archived.length > 0 && (
        <details className="group/archived rounded-panel border border-line">
          <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden rounded-panel">
            <ChevronRight
              size={16}
              aria-hidden
              className="text-ink-muted transition-transform duration-[120ms] group-open/archived:rotate-90"
            />
            <span className="text-base font-medium text-ink-muted">{t("homeArchived", locale)}</span>
            <span className="text-sm text-ink-muted tabular-nums">{sections.archived.length}</span>
          </summary>
          <ul className={cn(GRID_CLASS, "px-4 pb-4")}>
            {sections.archived.map((b) => (
              <li key={b.id} className="h-full">
                <BoardCard board={b} locale={locale} muted />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
