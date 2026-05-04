"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import BoardCard, { type BoardCardData } from "./BoardCard";
import CreateBoardModal from "./CreateBoardModal";
import { moveBoardAction } from "@/server/tasks-actions";
import { type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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

type Board = BoardCardData & { categoryId: string | null; position: number };

interface Props {
  boards: Board[];
  categories: CategoryOption[];
  users: UserOption[];
  locale: Locale;
}

const GRID_CLASS = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr";

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
  const [boards, setBoards] = useState<Board[]>(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<DragOver | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    setBoards(initial);
  }, [initial]);

  const draggedBoard = useMemo(
    () => (dragId ? boards.find((b) => b.id === dragId) ?? null : null),
    [boards, dragId]
  );

  const sections = useMemo(() => {
    const general = boards
      .filter((b) => !b.categoryId)
      .sort((a, b) => a.position - b.position);
    const byCat = new Map<string, Board[]>();
    for (const cat of categories) byCat.set(cat.id, []);
    for (const b of boards) {
      if (b.categoryId && byCat.has(b.categoryId)) {
        byCat.get(b.categoryId)!.push(b);
      }
    }
    for (const [k, list] of byCat) {
      byCat.set(k, list.sort((a, b) => a.position - b.position));
    }
    return { general, byCat };
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
    commitMove(dragId, categoryId, filteredIdx);
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
        <li className="h-full">
          <CreateBoardModal
            users={users}
            categories={categories}
            defaultCategoryId={categoryId}
            locale={locale}
            variant="card"
          />
        </li>
      </ul>
    );
  }

  return (
    <>
      {renderGrid(sections.general, null)}

      {categories.map((cat) => {
        const list = sections.byCat.get(cat.id) ?? [];
        const isTargetEmpty =
          dragId !== null &&
          dragOver?.categoryId === cat.id &&
          list.filter((b) => b.id !== dragId).length === 0;
        return (
          <section
            key={cat.id}
            className={cn(
              "space-y-3 rounded-xl transition-colors duration-150",
              isTargetEmpty && "bg-slate-50 dark:bg-slate-900/40 ring-2 ring-dashed"
            )}
            style={
              isTargetEmpty
                ? { boxShadow: `inset 0 0 0 2px ${draggedBoard?.color ?? "#2563eb"}` }
                : undefined
            }
          >
            <header className="flex items-center gap-2 px-1">
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
            {renderGrid(list, cat.id)}
          </section>
        );
      })}
    </>
  );
}
