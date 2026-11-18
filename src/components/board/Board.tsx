"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CalendarDays, Columns3, Keyboard, List, Plus, Sparkles } from "lucide-react";
import { useSyncedState } from "@/lib/use-synced-state";
import { getViewingCard, subscribeBoardStream } from "@/lib/board-stream";
import { animateChanges, snapshotCards, type CardSnapshot } from "./live-changes";
import { t, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  addColumnAction,
  deleteCardAction,
  deleteColumnAction,
  moveColumnAction,
  renameColumnAction,
} from "@/server/tasks-actions";
import { TEMP_PREFIX, newId, splitTitles, type CardFields } from "@/lib/outbox";
import { useOfflineBoard } from "./useOfflineBoard";
import OfflineBanner from "./OfflineBanner";
import { createCardFromTemplateAction, saveCardAsTemplateAction } from "@/server/template-actions";
import { useUi } from "@/components/ui/UiProvider";
import { useUndo } from "@/components/ui/useUndo";
import { buttonClass } from "@/components/ui/button";
import CardFace from "./CardFace";
import Column, { type ColumnHandlers } from "./Column";
import FilterBar from "./FilterBar";
import ListView from "./ListView";
import CalendarView from "./CalendarView";
import { DatePickerPopover } from "@/components/ui/DatePicker";
import { EMPTY_FILTERS, isFiltering, type Filters } from "@/lib/board-filters";
import { deadlineKey, parseView, type BoardView } from "@/lib/board-views";
import { MoveCardDialog, ShortcutsDialog } from "./dialogs";
import type { CardMenuHandlers } from "./CardMenu";
import {
  columnIdOf,
  columnKey,
  isColumnKey,
  type CardDTO,
  type CardPatch,
  type ColumnDTO,
  type MemberOption,
  type SavedFilterDTO,
  type TagOption,
  type TemplateOption,
} from "./types";

export interface BoardProps {
  boardId: string;
  columns: ColumnDTO[];
  locale: Locale;
  canManage: boolean;
  currentUserId: string;
  members: MemberOption[];
  boardTags: TagOption[];
  savedFilters: SavedFilterDTO[];
  templates?: TemplateOption[];
  /** When the server rendered this data (ISO), to compare with the offline snapshot. */
  renderedAt?: string;
}

const VIEW_ICONS = { board: Columns3, list: List, calendar: CalendarDays } as const;
const VIEW_LABELS = { board: "viewBoard", list: "viewList", calendar: "viewCalendar" } as const;

const COLLAPSE_EVENT = "kanbun:collapsed";

// Keyboard dragging: Left/Right jump a card to the neighbouring column,
// Up/Down reorder within the column (dnd-kit's default getter only looks at
// geometry, so cards in the same column could win over the next column).
const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { active, collisionRect, droppableRects, droppableContainers } = args.context;
  const horizontal = event.code === "ArrowLeft" || event.code === "ArrowRight";
  if (!horizontal || !active || !collisionRect || isColumnKey(String(active.id))) {
    return sortableKeyboardCoordinates(event, args);
  }
  event.preventDefault();
  const cols = droppableContainers
    .getEnabled()
    .filter((c) => isColumnKey(String(c.id)))
    .map((c) => droppableRects.get(c.id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.left - b.left);
  const centerX = collisionRect.left + collisionRect.width / 2;
  const current = cols.findIndex((r) => centerX >= r.left && centerX <= r.right);
  const target = cols[current + (event.code === "ArrowRight" ? 1 : -1)];
  if (current < 0 || !target) return undefined;
  return { x: target.left + 8, y: target.top + 44 };
};

// Collapsed columns are a per-browser preference. useSyncExternalStore keeps
// the server render and hydration identical (nothing collapsed) and then
// applies the stored value without a mismatch.
function useCollapsedColumns(boardId: string) {
  const key = `kanbun:collapsed:${boardId}`;
  const raw = useSyncExternalStore(
    (notify) => {
      window.addEventListener(COLLAPSE_EVENT, notify);
      window.addEventListener("storage", notify);
      return () => {
        window.removeEventListener(COLLAPSE_EVENT, notify);
        window.removeEventListener("storage", notify);
      };
    },
    () => {
      try {
        return localStorage.getItem(key) ?? "";
      } catch {
        return "";
      }
    },
    () => ""
  );
  const collapsed = useMemo(() => new Set(raw ? raw.split(",") : []), [raw]);
  function toggle(columnId: string) {
    const next = new Set(collapsed);
    if (next.has(columnId)) next.delete(columnId);
    else next.add(columnId);
    try {
      localStorage.setItem(key, [...next].join(","));
    } catch {
      // Storage unavailable (private mode): the toggle just won't persist.
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  }
  return [collapsed, toggle] as const;
}

function containerOf(columns: ColumnDTO[], id: UniqueIdentifier): string | null {
  const key = String(id);
  if (isColumnKey(key)) return columnIdOf(key);
  return columns.find((c) => c.cards.some((card) => card.id === key))?.id ?? null;
}

function moveCardLocally(columns: ColumnDTO[], cardId: string, toColumnId: string, index: number): ColumnDTO[] {
  let moved: CardDTO | undefined;
  const without = columns.map((c) => {
    const i = c.cards.findIndex((card) => card.id === cardId);
    if (i < 0) return c;
    moved = c.cards[i];
    return { ...c, cards: c.cards.filter((card) => card.id !== cardId) };
  });
  if (!moved) return columns;
  return without.map((c) => {
    if (c.id !== toColumnId) return c;
    const cards = [...c.cards];
    cards.splice(Math.max(0, Math.min(index, cards.length)), 0, moved!);
    return { ...c, cards };
  });
}

export default function Board({
  boardId,
  columns: serverColumns,
  locale,
  canManage,
  currentUserId,
  members,
  boardTags,
  savedFilters,
  templates = [],
  renderedAt,
}: BoardProps) {
  const offline = useOfflineBoard({ boardId, userId: currentUserId, serverColumns, renderedAt, locale });
  const [columns, setColumns] = useSyncedState(offline.columns);
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get("view"));
  // `?deadline=none` comes from the calendar's "Show in list" link.
  const [filters, setFilters] = useState<Filters>(() =>
    searchParams.get("deadline") === "none" ? { ...EMPTY_FILTERS, deadline: "none" } : EMPTY_FILTERS
  );
  const [deadlineCard, setDeadlineCard] = useState<CardDTO | null>(null);
  const deadlineAnchor = useRef<HTMLElement | null>(null);
  const boardScroller = useRef<HTMLDivElement>(null);
  const [visibleColumnIndex, setVisibleColumnIndex] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addingColumnId, setAddingColumnId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [movingCard, setMovingCard] = useState<CardDTO | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapsedColumns(boardId);
  const dragStart = useRef<{ snapshot: ColumnDTO[]; columnId: string | null; index: number } | null>(null);
  const refreshPending = useRef(false);
  const liveSnapshot = useRef<CardSnapshot | null>(null);
  const columnsRef = useRef(serverColumns);
  const router = useRouter();
  const ui = useUi();
  const offerUndo = useUndo();
  const tr = (key: Parameters<typeof t>[0], vars: Record<string, string | number> = {}) =>
    Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), t(key, locale));

  // Live updates: re-fetch when anyone changes the board. Deferred while a
  // drag is in progress so the list does not jump under the pointer.
  // Before a live re-fetch, remember where every card is so teammates'
  // changes can animate into place once the new data renders.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeBoardStream(boardId, {
      onBoard: () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (dragStart.current) {
            refreshPending.current = true;
            return;
          }
          if (boardScroller.current) liveSnapshot.current = snapshotCards(boardScroller.current, columnsRef.current);
          router.refresh();
        }, 250);
      },
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [boardId, router]);

  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);

  useLayoutEffect(() => {
    const before = liveSnapshot.current;
    liveSnapshot.current = null;
    if (!before || !boardScroller.current || dragStart.current) return;
    animateChanges(boardScroller.current, before, serverColumns, getViewingCard(boardId));
  }, [serverColumns, boardId]);

  const allCards = useMemo(() => columns.flatMap((c) => c.cards), [columns]);
  const filtering = isFiltering(filters);

  const matches = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    return (card: CardDTO) => {
      if (q && !card.title.toLowerCase().includes(q)) return false;
      if (filters.assigneeId && !card.assignees.some((u) => u.id === filters.assigneeId)) return false;
      if (filters.mine && !card.assignees.some((u) => u.id === currentUserId)) return false;
      if (filters.tagId && !card.tags.some((tg) => tg.id === filters.tagId)) return false;
      if (filters.priority && card.priority !== filters.priority) return false;
      if (filters.deadline === "none" && card.deadline) return false;
      if (filters.deadline === "has" && !card.deadline) return false;
      if (filters.deadline === "overdue" && (!card.deadline || card.deadline.slice(0, 10) >= today)) return false;
      return true;
    };
  }, [filters, currentUserId]);

  const assigneeOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const card of allCards) for (const u of card.assignees) map.set(u.id, { id: u.id, name: u.displayName ?? u.username });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allCards]);
  const tagOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const card of allCards) for (const tg of card.tags) map.set(tg.id, { id: tg.id, name: tg.name });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allCards]);
  const visibleColumns = useMemo(
    () => (filtering ? columns.map((c) => ({ ...c, cards: c.cards.filter(matches) })) : columns),
    [columns, filtering, matches]
  );
  const visibleCards = useMemo(() => visibleColumns.flatMap((c) => c.cards), [visibleColumns]);
  const visibleCount = visibleCards.length;

  // The view lives in the URL (?view=list|calendar) so it can be linked and
  // survives a reload. Next.js keeps useSearchParams in sync with
  // history.replaceState, so switching views needs no server round trip.
  function setView(next: BoardView) {
    const params = new URLSearchParams(window.location.search);
    if (next === "board") params.delete("view");
    else params.set("view", next);
    params.delete("deadline");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  function showNoDeadlineList() {
    setFilters({ ...filters, deadline: "none" });
    setView("list");
  }

  function openDeadlinePicker(card: CardDTO) {
    // The popover is anchored to the card (or its row in the list view).
    const anchor = document.querySelector<HTMLElement>(`[data-card-id="${card.id}"]`);
    if (!anchor) return;
    deadlineAnchor.current = anchor;
    setDeadlineCard(card);
  }

  function setDeadline(card: CardDTO, value: string | null) {
    const deadline = value ? `${value}T00:00:00.000Z` : null;
    patchCard(card.id, { deadline });
    updateCard(card, { deadline });
  }

  // ---------- Optimistic card edits ----------

  function patchCard(cardId: string, patch: CardPatch) {
    setColumns((prev) =>
      prev.map((c) => ({ ...c, cards: c.cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)) }))
    );
  }

  // Sent now, or queued while offline (useOfflineBoard).
  function updateCard(card: CardDTO, fields: CardFields) {
    offline.run({ kind: "update", cardId: card.id, fields }, fields.title ?? card.title);
  }

  const cardHandlers: CardMenuHandlers = {
    open: (card) => {
      if (offline.canOpenCard()) router.push(`/tasks/${boardId}/cards/${card.id}`, { scroll: false });
    },
    moveTo: (card) => setMovingCard(card),
    toggleAssignee: (card, user) => {
      const has = card.assignees.some((a) => a.id === user.id);
      patchCard(card.id, { assignees: has ? card.assignees.filter((a) => a.id !== user.id) : [...card.assignees, user] });
      offline.run({ kind: "assignee", cardId: card.id, user, on: !has }, card.title);
    },
    toggleTag: (card, tag) => {
      const has = card.tags.some((tg) => tg.id === tag.id);
      patchCard(card.id, { tags: has ? card.tags.filter((tg) => tg.id !== tag.id) : [...card.tags, tag] });
      offline.run({ kind: "tag", cardId: card.id, tag, on: !has }, card.title);
    },
    setPriority: (card, priority) => {
      patchCard(card.id, { priority });
      updateCard(card, { priority });
    },
    setCover: (card, color) => {
      patchCard(card.id, { coverColor: color });
      updateCard(card, { coverColor: color });
    },
    setDeadline: (card) => openDeadlinePicker(card),
    saveAsTemplate: async (card) => {
      if (!offline.guard()) return;
      const fd = new FormData();
      fd.set("cardId", card.id);
      const result = ui.report(await saveCardAsTemplateAction(fd));
      if (result.ok) ui.toast({ message: tr("templateSavedToast", { name: result.data.name }) });
      router.refresh();
    },
    remove: async (card) => {
      if (!offline.guard()) return;
      setColumns((prev) => prev.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== card.id) })));
      const fd = new FormData();
      fd.set("cardId", card.id);
      const result = ui.report(await deleteCardAction(fd));
      if (result.ok) offerUndo(t("cardDeleted", locale), result.data.trashId);
      router.refresh();
    },
  };

  async function moveCard(card: CardDTO, toColumnId: string, position: number, announce = true) {
    setColumns((prev) => moveCardLocally(prev, card.id, toColumnId, position));
    const result = await offline.run({ kind: "move", cardId: card.id, toColumnId, position }, card.title);
    if (result.ok && announce) {
      const column = columns.find((c) => c.id === toColumnId);
      if (column) ui.toast({ message: tr("cardMovedToast", { column: column.name }) });
    }
  }

  async function moveColumn(columnId: string, toIndex: number) {
    if (!offline.guard()) return;
    setColumns((prev) => {
      const from = prev.findIndex((c) => c.id === columnId);
      return from < 0 ? prev : arrayMove(prev, from, toIndex);
    });
    ui.report(await moveColumnAction({ columnId, position: toIndex }));
    router.refresh();
  }

  const columnHandlers: ColumnHandlers = {
    rename: async (column, name, wipLimit) => {
      if (!offline.guard()) return false;
      const fd = new FormData();
      fd.set("columnId", column.id);
      fd.set("name", name);
      fd.set("wipLimit", wipLimit == null ? "" : String(wipLimit));
      const ok = ui.report(await renameColumnAction(fd)).ok;
      if (ok) {
        setColumns((prev) => prev.map((c) => (c.id === column.id ? { ...c, name, wipLimit } : c)));
        router.refresh();
      }
      return ok;
    },
    move: (column, delta) => {
      const index = columns.findIndex((c) => c.id === column.id);
      moveColumn(column.id, index + delta);
    },
    toggleCollapsed: (column) => toggleCollapsed(column.id),
    remove: async (column) => {
      if (!offline.guard()) return;
      setColumns((prev) => prev.filter((c) => c.id !== column.id));
      const fd = new FormData();
      fd.set("columnId", column.id);
      const result = ui.report(await deleteColumnAction(fd));
      if (result.ok) offerUndo(tr("columnDeleted", { name: column.name }), result.data.trashId);
      router.refresh();
    },
    addCards: async (column, text) => {
      const titles = splitTitles(text);
      if (titles.length === 0) return false;
      const tempIds = titles.map(() => newId(TEMP_PREFIX));
      const result = await offline.run({ kind: "addCards", columnId: column.id, titles, tempIds }, titles.join(", "));
      if (result.ok && titles.length > 1) ui.toast({ message: tr("cardsAdded", { count: titles.length }) });
      return result.ok;
    },
    addFromTemplate: async (column, template) => {
      if (!offline.guard()) return;
      const result = ui.report(await createCardFromTemplateAction({ templateId: template.id, columnId: column.id }));
      if (result.ok) ui.toast({ message: tr("cardFromTemplateToast", { name: template.name, column: column.name }) });
      router.refresh();
    },
    setAdding: setAddingColumnId,
    renameCard: (card, title) => {
      patchCard(card.id, { title });
      updateCard(card, { title });
    },
    setEditing: setEditingCardId,
  };

  // ---------- Drag and drop ----------

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press on touch, so swiping still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    // Space lifts and drops; Enter is left to the link so it opens the card.
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    })
  );

  const collisionDetection: CollisionDetection = (args) => {
    if (args.active.data.current?.type === "column") {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => isColumnKey(String(c.id))),
      });
    }
    const hits = pointerWithin(args);
    const collisions = hits.length > 0 ? hits : rectIntersection(args);
    const overId = getFirstCollision(collisions, "id");
    if (overId != null && isColumnKey(String(overId))) {
      const column = columns.find((c) => columnKey(c.id) === overId);
      if (column && column.cards.length > 0) {
        const inner = closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) => column.cards.some((card) => card.id === c.id)),
        });
        if (inner.length > 0) return inner;
      }
    }
    return collisions;
  };

  function onDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    const columnId = containerOf(columns, id);
    const index = isColumnKey(id)
      ? columns.findIndex((c) => columnKey(c.id) === id)
      : columns.find((c) => c.id === columnId)?.cards.findIndex((c) => c.id === id) ?? -1;
    dragStart.current = { snapshot: columns, columnId, index };
    setActiveId(id);
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || isColumnKey(String(active.id))) return;
    const from = containerOf(columns, active.id);
    const to = containerOf(columns, over.id);
    if (!from || !to || from === to) return;
    const target = columns.find((c) => c.id === to)!;
    const overIndex = target.cards.findIndex((c) => c.id === over.id);
    setColumns((prev) => moveCardLocally(prev, String(active.id), to, overIndex < 0 ? target.cards.length : overIndex));
  }

  function finishDrag() {
    dragStart.current = null;
    setActiveId(null);
    if (refreshPending.current) {
      refreshPending.current = false;
      router.refresh();
    }
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const start = dragStart.current;
    const id = String(active.id);
    if (!over || !start) {
      if (start) setColumns(start.snapshot);
      finishDrag();
      return;
    }
    if (isColumnKey(id)) {
      const from = columns.findIndex((c) => columnKey(c.id) === id);
      const overColumn = containerOf(columns, over.id);
      const to = columns.findIndex((c) => c.id === overColumn);
      finishDrag();
      if (from >= 0 && to >= 0 && from !== to) moveColumn(columnIdOf(id), to);
      return;
    }
    const columnId = containerOf(columns, id);
    const column = columns.find((c) => c.id === columnId);
    if (!column) {
      finishDrag();
      return;
    }
    let index = column.cards.findIndex((c) => c.id === id);
    const overIndex = column.cards.findIndex((c) => c.id === over.id);
    if (overIndex >= 0 && overIndex !== index) {
      setColumns((prev) =>
        prev.map((c) => (c.id === column.id ? { ...c, cards: arrayMove(c.cards, index, overIndex) } : c))
      );
      index = overIndex;
    }
    finishDrag();
    if (column.id !== start.columnId || index !== start.index) {
      offline.run({ kind: "move", cardId: id, toColumnId: column.id, position: index }, titleOf(id));
    }
  }

  function onDragCancel() {
    if (dragStart.current) setColumns(dragStart.current.snapshot);
    finishDrag();
  }

  const titleOf = (id: UniqueIdentifier) => {
    const key = String(id);
    if (isColumnKey(key)) return columns.find((c) => columnKey(c.id) === key)?.name ?? "";
    return allCards.find((c) => c.id === key)?.title ?? "";
  };
  const placeOf = (id: UniqueIdentifier, overId: UniqueIdentifier) => {
    const columnId = containerOf(columns, overId);
    const column = columns.find((c) => c.id === columnId);
    if (!column) return null;
    const i = column.cards.findIndex((c) => c.id === String(overId));
    const own = column.cards.some((c) => c.id === String(id));
    const count = column.cards.length + (own ? 0 : 1);
    return { column: column.name, position: i < 0 ? count : i + 1, count };
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      isColumnKey(String(active.id))
        ? tr("dndColumnPickedUp", { name: titleOf(active.id) })
        : tr("dndPickedUp", { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) => {
      if (!over) return;
      if (isColumnKey(String(active.id))) {
        const i = columns.findIndex((c) => c.id === containerOf(columns, over.id));
        return tr("dndColumnOver", { name: titleOf(active.id), position: i + 1, count: columns.length });
      }
      const place = placeOf(active.id, over.id);
      return place ? tr("dndOver", { title: titleOf(active.id), ...place }) : undefined;
    },
    onDragEnd: ({ active, over }) => {
      if (!over) return tr("dndCancelled", { title: titleOf(active.id) });
      if (isColumnKey(String(active.id))) {
        const i = columns.findIndex((c) => c.id === containerOf(columns, over.id));
        return tr("dndColumnDropped", { name: titleOf(active.id), position: i + 1, count: columns.length });
      }
      const place = placeOf(active.id, over.id);
      return place ? tr("dndDropped", { title: titleOf(active.id), ...place }) : undefined;
    },
    onDragCancel: ({ active }) => tr("dndCancelled", { title: titleOf(active.id) }),
  };

  // ---------- Keyboard shortcuts (DESIGN.md section 6) ----------

  useEffect(() => {
    function focusCard(el: Element | null | undefined) {
      (el?.querySelector("a") as HTMLElement | null)?.focus();
    }
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || dragStart.current) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox']")) return;
      const cardEl = target.closest("[data-card-id]");
      const cardId = cardEl?.getAttribute("data-card-id") ?? null;
      const columnEl = target.closest("[data-column-id]");
      const card = cardId ? allCards.find((c) => c.id === cardId) : undefined;

      const key = e.key;
      if (key === "/") {
        e.preventDefault();
        setFilterOpen(true);
      } else if (key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (key === "d" && card) {
        e.preventDefault();
        openDeadlinePicker(card);
      } else if (key === "a" && card) {
        const me = members.find((m) => m.id === currentUserId);
        if (me) {
          e.preventDefault();
          cardHandlers.toggleAssignee(card, me);
        }
      } else if (view !== "board") {
        // Adding, inline editing and j/k navigation belong to the board view.
        return;
      } else if (key === "n" && !filtering) {
        e.preventDefault();
        setAddingColumnId(columnEl?.getAttribute("data-column-id") ?? columns[0]?.id ?? null);
      } else if (key === "e" && card) {
        e.preventDefault();
        setEditingCardId(card.id);
      } else if (["j", "k", "h", "l", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(key)) {
        const columnsEls = [...document.querySelectorAll("[data-column-id]")];
        if (!cardEl) {
          if (key === "j" || key === "ArrowDown") {
            e.preventDefault();
            focusCard(document.querySelector("[data-card-id]"));
          }
          return;
        }
        e.preventDefault();
        const colEl = cardEl.closest("[data-column-id]")!;
        const cards = [...colEl.querySelectorAll("[data-card-id]")];
        const i = cards.indexOf(cardEl);
        if (key === "j" || key === "ArrowDown") focusCard(cards[i + 1]);
        else if (key === "k" || key === "ArrowUp") focusCard(cards[i - 1]);
        else {
          const ci = columnsEls.indexOf(colEl);
          const step = key === "h" || key === "ArrowLeft" ? -1 : 1;
          for (let c = ci + step; c >= 0 && c < columnsEls.length; c += step) {
            const next = columnsEls[c].querySelectorAll("[data-card-id]");
            if (next.length) {
              focusCard(next[Math.min(i, next.length - 1)]);
              break;
            }
          }
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const activeCard = activeId && !isColumnKey(activeId) ? allCards.find((c) => c.id === activeId) : null;
  const activeColumn = activeId && isColumnKey(activeId) ? columns.find((c) => columnKey(c.id) === activeId) : null;

  const shared = {
    boardId,
    locale,
    canManage,
    dndDisabled: filtering,
    members,
    boardTags,
    templates,
    currentUserId,
    cardHandlers,
    columnHandlers,
    editingCardId,
  };

  const showAddBar = view === "board" && !filtering && columns.length > 0;
  const addBarColumn = columns[Math.min(visibleColumnIndex, columns.length - 1)];

  // Phones show one column at a time: track which one is in view so the
  // bottom "Add card" bar adds to it.
  function onBoardScroll() {
    const scroller = boardScroller.current;
    if (!scroller) return;
    const left = scroller.getBoundingClientRect().left;
    const els = [...scroller.querySelectorAll<HTMLElement>(":scope > [data-column-id]")];
    let best = 0;
    els.forEach((el, i) => {
      if (Math.abs(el.getBoundingClientRect().left - left) < Math.abs(els[best].getBoundingClientRect().left - left)) best = i;
    });
    if (best !== visibleColumnIndex) setVisibleColumnIndex(best);
  }

  return (
    <div className={cn("space-y-3", showAddBar && "pb-16 sm:pb-0")}>
      <OfflineBanner
        showOffline={offline.showOffline}
        dataTime={offline.dataTime}
        pending={offline.pending}
        syncing={offline.syncing}
        locale={locale}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <ToggleButtonGroup
          aria-label={t("viewSwitcher", locale)}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[view]}
          onSelectionChange={(keys) => {
            const next = [...keys][0];
            if (next) setView(parseView(String(next)));
          }}
          className="inline-flex items-center gap-0.5 rounded-control border border-line-strong bg-surface p-0.5"
        >
          {(Object.keys(VIEW_ICONS) as BoardView[]).map((v) => {
            const Icon = VIEW_ICONS[v];
            return (
              <ToggleButton
                key={v}
                id={v}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] text-sm text-ink-muted cursor-default outline-none transition-colors duration-[120ms] data-[hovered]:text-ink data-[selected]:bg-accent-soft data-[selected]:text-accent data-[selected]:font-medium data-[focus-visible]:ring-2 data-[focus-visible]:ring-accent"
              >
                <Icon size={16} aria-hidden />
                {t(VIEW_LABELS[v], locale)}
              </ToggleButton>
            );
          })}
        </ToggleButtonGroup>
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          assigneeOptions={assigneeOptions}
          tagOptions={tagOptions}
          filtering={filtering}
          visibleCount={visibleCount}
          locale={locale}
          open={filterOpen}
          setOpen={setFilterOpen}
          boardId={boardId}
          savedFilters={savedFilters}
        />
        <button type="button" className={buttonClass("ghost", "md", "hidden sm:inline-flex")} onClick={() => setShortcutsOpen(true)}>
          <Keyboard size={16} aria-hidden />
          {t("shortcutsButton", locale)}
          <kbd className="text-xs text-ink-muted border border-line rounded px-1">?</kbd>
        </button>
      </div>

      {view === "list" && <ListView boardId={boardId} columns={visibleColumns} locale={locale} filtering={filtering} />}

      {view === "calendar" && (
        <CalendarView
          boardId={boardId}
          cards={visibleCards}
          locale={locale}
          noDeadlineHref="?view=list&deadline=none"
          onShowNoDeadline={showNoDeadlineList}
        />
      )}

      {view === "board" && !filtering && allCards.length === 0 && (
        <div className="flex flex-wrap items-start gap-3 rounded-panel border border-dashed border-line-strong bg-surface px-4 py-3">
          <Sparkles size={18} aria-hidden className="mt-0.5 text-accent shrink-0" />
          <div className="flex-1 min-w-[14rem] space-y-0.5">
            <h2 className="font-semibold">{t("boardEmptyTitle", locale)}</h2>
            <p className="text-sm text-ink-muted">
              {columns.length === 0 ? t("boardEmptyNoColumns", locale) : t("boardEmptyBody", locale)}
            </p>
          </div>
          {columns.length > 0 && (
            <button
              type="button"
              className={buttonClass("primary", "md")}
              onClick={() => {
                if (collapsed.has(columns[0].id)) toggleCollapsed(columns[0].id);
                setAddingColumnId(columns[0].id);
              }}
            >
              <Plus size={16} aria-hidden />
              {tr("boardEmptyAction", { column: columns[0].name })}
            </button>
          )}
        </div>
      )}

      {view === "board" && (
        <>
          <nav aria-label={t("columnJump", locale)} className="sm:hidden -mx-4 px-4 flex gap-1.5 overflow-x-auto pb-1">
            {columns.map((c) => (
              <button
                key={c.id}
                type="button"
                className="shrink-0 rounded-full border border-line bg-surface px-3 py-1 text-sm"
                onClick={() =>
                  document
                    .querySelector(`[data-column-id="${c.id}"]`)
                    ?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })
                }
              >
                {c.name} <span className="text-ink-muted tabular-nums">{c.cards.length}</span>
              </button>
            ))}
          </nav>

          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
            accessibility={{ announcements, screenReaderInstructions: { draggable: t("dndInstructions", locale) } }}
          >
            <div
              ref={boardScroller}
              onScroll={onBoardScroll}
              className="relative -mx-4 sm:-mx-6 px-4 sm:px-6 flex items-start gap-3 overflow-x-auto pb-4 snap-x snap-mandatory sm:snap-none scroll-px-4"
            >
              <SortableContext items={columns.map((c) => columnKey(c.id))} strategy={horizontalListSortingStrategy}>
                {visibleColumns.map((col, index) => (
                  <Column
                    key={col.id}
                    column={columns[index]}
                    visibleCards={col.cards}
                    index={index}
                    total={columns.length}
                    collapsed={collapsed.has(col.id) && !filtering}
                    adding={addingColumnId === col.id}
                    shared={shared}
                  />
                ))}
              </SortableContext>
              {!filtering && canManage && <AddColumnForm boardId={boardId} locale={locale} guard={offline.guard} />}
            </div>
            <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
              {activeCard ? (
                <div className="relative overflow-hidden rounded-card bg-raised border border-line-strong shadow-float px-3 pt-2.5 pb-2.5 rotate-[1.5deg] cursor-grabbing w-[85vw] sm:w-[16.5rem]">
                  <CardFace card={activeCard} locale={locale} />
                </div>
              ) : activeColumn ? (
                <div className="w-72 rounded-panel bg-surface border border-line-strong shadow-float px-3 py-2 font-semibold cursor-grabbing">
                  {activeColumn.name}
                  <span className="ml-2 text-sm text-ink-muted tabular-nums">{activeColumn.cards.length}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      )}

      {filtering && visibleCount === 0 && <p className="text-ink-muted px-1">{t("filterNoMatch", locale)}</p>}

      {showAddBar && addBarColumn && (
        <div className="sm:hidden fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 pt-2 pb-[calc(0.5rem+var(--safe-bottom))]">
          <button
            type="button"
            className={buttonClass("primary", "lg", "w-full")}
            onClick={() => {
              if (collapsed.has(addBarColumn.id)) toggleCollapsed(addBarColumn.id);
              setAddingColumnId(addBarColumn.id);
            }}
          >
            <Plus size={18} aria-hidden />
            <span className="truncate">{tr("mobileAddCard", { column: addBarColumn.name })}</span>
          </button>
        </div>
      )}

      <DatePickerPopover
        triggerRef={deadlineAnchor}
        isOpen={deadlineCard !== null}
        onOpenChange={(open) => {
          if (!open) setDeadlineCard(null);
        }}
        title={deadlineCard ? tr("datePickerTitle", { title: deadlineCard.title }) : ""}
        value={deadlineCard?.deadline ? deadlineKey(deadlineCard.deadline) : null}
        onChange={(value) => {
          if (deadlineCard) setDeadline(deadlineCard, value);
        }}
        locale={locale}
      />

      <MoveCardDialog
        card={movingCard}
        columns={columns}
        locale={locale}
        onClose={() => setMovingCard(null)}
        onMove={(card, columnId, position) => moveCard(card, columnId, position)}
      />
      <ShortcutsDialog open={shortcutsOpen} locale={locale} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function AddColumnForm({ boardId, locale, guard }: { boardId: string; locale: Locale; guard: () => boolean }) {
  const [open, setOpen] = useState(false);
  const { report } = useUi();
  const router = useRouter();
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(buttonClass("ghost", "md", "shrink-0 w-[85vw] sm:w-72 justify-start border border-dashed border-line-strong rounded-panel h-11"))}
      >
        <Plus size={16} aria-hidden />
        {t("columnAdd", locale)}
      </button>
    );
  }
  return (
    <form
      className="shrink-0 w-[85vw] sm:w-72 bg-surface border border-line rounded-panel p-3 space-y-2"
      action={async (fd) => {
        if (!guard() || !report(await addColumnAction(fd)).ok) return;
        setOpen(false);
        router.refresh();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <input type="hidden" name="boardId" value={boardId} />
      <input name="name" required maxLength={80} autoFocus aria-label={t("columnName", locale)} placeholder={t("columnName", locale)} />
      <div className="flex gap-2">
        <button className={buttonClass("primary", "sm")}>{t("add", locale)}</button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("ghost", "sm")}>
          {t("cancel", locale)}
        </button>
      </div>
    </form>
  );
}
