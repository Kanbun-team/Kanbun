"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Button as AriaButton,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger,
  Popover,
  ToggleButton,
  ToggleButtonGroup,
} from "react-aria-components";
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
  useDndContext,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type KeyboardSensorProps,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CalendarDays, Check, ChevronDown, Columns3, Keyboard, List, Plus, Rows3, Sparkles } from "lucide-react";
import { GROUPS, blankLane, buildLanes, laneChange, parseGroup, type GroupBy } from "@/lib/swimlanes";
import Swimlanes, { laneKeyboardCoordinates, laneNavigate, type LaneHandlers } from "./Swimlanes";
import { intlLocale } from "@/lib/i18n";
import { blankCard, type OutboxOp } from "@/lib/outbox";
import { useSyncedState } from "@/lib/use-synced-state";
import { useStableHandlers, useStableValue } from "@/lib/use-stable";
import { reconcileColumns } from "./reconcile";
import { getViewingCard, markBoardRefreshed, refreshedSince, subscribeBoardStream } from "@/lib/board-stream";
import { animateChanges, markLocalCards, snapshotCards, type CardSnapshot } from "./live-changes";
import { t, tn, type Locale } from "@/lib/i18n";
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
import OfflineCardSheet from "@/components/card/OfflineCardSheet";
import type { BoardCardFallback } from "@/components/card/OfflineCardView";
import { createCardFromTemplateAction, saveCardAsTemplateAction } from "@/server/template-actions";
import { useUi } from "@/components/ui/UiProvider";
import { useUndo } from "@/components/ui/useUndo";
import { useRuleUndo } from "@/components/ui/useRuleUndo";
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
// Cards that do not match the filter stay in the page, hidden (see Column).
const VISIBLE_CARD = "[data-card-id]:not([hidden])";
const NO_TEMPLATES: TemplateOption[] = [];

// Sensor options must keep their identity (Board creates them once): new
// option objects would give every sortable card new listeners and defeat
// memoization.
const MOUSE_OPTIONS = { activationConstraint: { distance: 6 } };
// Long-press on touch, so swiping still scrolls the board.
const TOUCH_OPTIONS = { activationConstraint: { delay: 250, tolerance: 8 } };

// Drag and drop is off while a filter hides cards. The sensors refuse to
// start a drag then, instead of every card being disabled: switching all
// cards' drag and drop state off and on re-renders each of them, which made
// clearing a filter slow on large boards (docs/PERFORMANCE.md).
type Handler = (event: unknown, options: { blocked?: () => boolean }, context: unknown) => boolean | undefined;
function gated<T extends readonly { eventName: string; handler: unknown }[]>(activators: T): T {
  return activators.map(({ eventName, handler }) => ({
    eventName,
    handler: ((event, options, context) => !options.blocked?.() && (handler as Handler)(event, options, context) === true) as Handler,
  })) as unknown as T;
}
class BoardMouseSensor extends MouseSensor {
  static activators = gated(MouseSensor.activators);
}
class BoardTouchSensor extends TouchSensor {
  static activators = gated(TouchSensor.activators);
}
class BoardKeyboardSensor extends KeyboardSensor {
  static activators = gated(KeyboardSensor.activators);

  constructor(props: KeyboardSensorProps) {
    super(props);
    // dnd-kit listens for keys only from the next task on, so that the Space
    // that started the drag is not seen again. A pick up is now fast enough
    // for an arrow key to arrive before that and be lost, so arrow keys in
    // that gap are handed to the sensor here. Space and Escape are left alone:
    // ending the drag this early would let dnd-kit's late listener act on a
    // finished drag.
    const doc = (props.event.target as Node | null)?.ownerDocument ?? document;
    const sensor = this as unknown as { handleKeyDown(event: KeyboardEvent): void };
    const early = (event: KeyboardEvent) => {
      if (!event.code.startsWith("Arrow")) return;
      event.stopImmediatePropagation();
      sensor.handleKeyDown(event);
    };
    doc.addEventListener("keydown", early, true);
    setTimeout(() => doc.removeEventListener("keydown", early, true));
  }
}

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
    // Right after the pick-up dnd-kit may not have measured the columns yet:
    // read them from the DOM then.
    .map((c) => droppableRects.get(c.id) ?? c.node.current?.getBoundingClientRect())
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.left - b.left);
  const centerX = collisionRect.left + collisionRect.width / 2;
  const current = cols.findIndex((r) => centerX >= r.left && centerX <= r.right);
  const target = cols[current + (event.code === "ArrowRight" ? 1 : -1)];
  if (current < 0 || !target) return undefined;
  return { x: target.left + 8, y: target.top + 44 };
};

const DROP_ANIMATION = { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" };

// Swimlanes have their own keyboard moves (between lanes too). The sensors
// are created once, so the getter checks which board is on screen.
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) =>
  document.querySelector("[data-swimlanes]") ? laneKeyboardCoordinates(event, args) : keyboardCoordinates(event, args);

// Space lifts and drops; Enter is left to the link so it opens the card.
const KEYBOARD_OPTIONS = {
  coordinateGetter: boardKeyboardCoordinates,
  keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
};

// Collapsed columns are a per-browser preference. useSyncExternalStore keeps
// the server render and hydration identical (nothing collapsed) and then
// applies the stored value without a mismatch.
// The same goes for collapsed swimlanes (per board and grouping).
function useCollapsedColumns(key: string) {
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

/**
 * Where a card dragged over a column (not over one of its cards) goes: before
 * the first card whose middle is below the dragged card's middle. Only the
 * cards of columns the drag has reached are drop targets (see Column), so the
 * first time a drag enters a column it is over the column itself.
 */
function insertIndex(columnId: string, active: Active): number {
  const cards = document.querySelectorAll(`[data-column-id="${columnId}"] ${VISIBLE_CARD}`);
  const rect = active.rect.current.translated;
  if (!rect) return cards.length;
  const middle = rect.top + rect.height / 2;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (middle < r.top + r.height / 2) return i;
  }
  return cards.length;
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
    // A card that changes column starts a new stay: no "longer than usual".
    if (c.id !== toColumnId && moved.staleDays !== undefined) moved = { ...moved, staleDays: undefined };
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
  members: membersProp,
  boardTags: boardTagsProp,
  savedFilters,
  templates: templatesProp = NO_TEMPLATES,
  renderedAt,
}: BoardProps) {
  const offline = useOfflineBoard({ boardId, userId: currentUserId, serverColumns, renderedAt, locale });
  // Unchanged cards keep their object across refreshes (see reconcile.ts).
  const [columns, setColumns] = useSyncedState(offline.columns, reconcileColumns);
  const members = useStableValue(membersProp);
  const boardTags = useStableValue(boardTagsProp);
  const templates = useStableValue(templatesProp);
  const searchParams = useSearchParams();
  // While the card panel is open the URL is the card's, without ?view= and
  // ?group=: the board underneath keeps the view and lanes it had.
  const onBoardPath = usePathname() === `/tasks/${boardId}`;
  const urlLayout = `${parseView(searchParams.get("view"))} ${parseGroup(searchParams.get("group"))}`;
  const [keptLayout, setKeptLayout] = useState(urlLayout);
  if (onBoardPath && keptLayout !== urlLayout) setKeptLayout(urlLayout);
  const [viewParam, groupParam] = (onBoardPath ? urlLayout : keptLayout).split(" ");
  const view = parseView(viewParam);
  // `?deadline=none` comes from the calendar's "Show in list" link.
  const [filters, setFilters] = useState<Filters>(() =>
    searchParams.get("deadline") === "none" ? { ...EMPTY_FILTERS, deadline: "none" } : EMPTY_FILTERS
  );
  const [deadlineCard, setDeadlineCard] = useState<CardDTO | null>(null);
  const deadlineAnchor = useRef<HTMLElement | null>(null);
  const boardScroller = useRef<HTMLDivElement>(null);
  const [visibleColumnIndex, setVisibleColumnIndex] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [addingColumnId, setAddingColumnId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  // The column whose cards are drop targets before a drag starts (see Column).
  const [armedColumnId, setArmedColumnId] = useState<string | null>(null);
  const [movingCard, setMovingCard] = useState<CardDTO | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapsedColumns(`kanbun:collapsed:${boardId}`);
  // Swimlanes (?group=), only in the board view.
  const group: GroupBy = view === "board" ? parseGroup(groupParam) : "none";
  const [collapsedLanes, toggleLane] = useCollapsedColumns(`kanbun:lanes:${boardId}:${group}`);
  const [addingCell, setAddingCell] = useState<string | null>(null);
  // Edits of a swimlane move in flight: live refreshes wait for them, like for a drag.
  const laneBusy = useRef(0);
  const dragStart = useRef<{ snapshot: ColumnDTO[]; columnId: string | null; index: number } | null>(null);
  const refreshPending = useRef(false);
  const liveSnapshot = useRef<CardSnapshot | null>(null);
  const columnsRef = useRef(serverColumns);
  const router = useRouter();
  const ui = useUi();
  const offerUndo = useUndo();
  const offerRuleUndo = useRuleUndo();
  const tr = (key: Parameters<typeof t>[0], vars: Record<string, string | number> = {}) =>
    Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), t(key, locale));

  // Live updates: re-fetch when anyone changes the board. Deferred while a
  // drag is in progress so the list does not jump under the pointer.
  // Before a live re-fetch, remember where every card is so teammates'
  // changes can animate into place once the new data renders.
  // Bursts of events become one refetch, and events already covered by a
  // refresh this tab started later (after its own edit) cause none.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastEventAt = 0;
    const unsubscribe = subscribeBoardStream(boardId, {
      onBoard: () => {
        lastEventAt = performance.now();
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (refreshedSince(boardId, lastEventAt)) return;
          if (dragStart.current || laneBusy.current > 0) {
            refreshPending.current = true;
            return;
          }
          if (boardScroller.current) liveSnapshot.current = snapshotCards(boardScroller.current, columnsRef.current);
          markBoardRefreshed(boardId);
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
  const visibleIds = useMemo(() => (filtering ? new Set(visibleCards.map((c) => c.id)) : null), [filtering, visibleCards]);
  // Same lanes, same object: the cells only re-render when their cards change.
  const lanes = useStableValue(
    useMemo(() => buildLanes(group, members, boardTags, allCards, intlLocale(locale)), [group, members, boardTags, allCards, locale])
  );

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

  // Swimlanes live in the URL too (?group=assignee|priority|tag).
  function setGroup(next: GroupBy) {
    const params = new URLSearchParams(window.location.search);
    if (next === "none") params.delete("group");
    else params.set("group", next);
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

  const latestCardHandlers: CardMenuHandlers = {
    open: (card) => {
      if (offline.canOpenCard(card.id)) router.push(`/tasks/${boardId}/cards/${card.id}`, { scroll: false });
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
    // Rules that ran on the move get the toast, with Undo for their changes.
    if (result.ok && offerRuleUndo(result.automation)) return;
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

  // Stable identities for the memoized columns and cards.
  const cardHandlers = useStableHandlers(latestCardHandlers);

  const latestColumnHandlers: ColumnHandlers = {
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
      if (result.ok && offerRuleUndo(result.automation)) return result.ok;
      if (result.ok && titles.length > 1) ui.toast({ message: tn("cardsAdded", titles.length, locale) });
      return result.ok;
    },
    addFromTemplate: async (column, template) => {
      if (!offline.guard()) return;
      const result = ui.report(await createCardFromTemplateAction({ templateId: template.id, columnId: column.id }));
      if (result.ok) markLocalCards([result.data.cardId]);
      if (result.ok && !offerRuleUndo(result.data.automation)) {
        ui.toast({ message: tr("cardFromTemplateToast", { name: template.name, column: column.name }) });
      }
      router.refresh();
    },
    setAdding: setAddingColumnId,
    renameCard: (card, title) => {
      patchCard(card.id, { title });
      updateCard(card, { title });
    },
    setEditing: setEditingCardId,
    arm: setArmedColumnId,
    prefetchCard: (card) => {
      if (!card.id.startsWith(TEMP_PREFIX)) router.prefetch(`/tasks/${boardId}/cards/${card.id}`);
    },
  };
  const columnHandlers = useStableHandlers(latestColumnHandlers);

  // Several edits that belong together (a move to another swimlane, or new
  // cards and their lane), sent in order with one refresh at the end, so the
  // card does not show a half-done state in between. New cards' temporary
  // ids are swapped for the real ones as soon as the server has made them;
  // offline, everything is queued and the outbox does that on sync.
  async function runChain(ops: OutboxOp[], label: string): Promise<boolean> {
    laneBusy.current += 1;
    const ids: Record<string, string> = {};
    let ok = true;
    let sent = false;
    try {
      for (const raw of ops) {
        const op = raw.kind !== "addCards" && ids[raw.cardId] ? { ...raw, cardId: ids[raw.cardId] } : raw;
        const result = await offline.run(op, label, { refresh: false });
        if (!result.queued) sent = true;
        if (!result.ok) {
          ok = false;
          break;
        }
        if (op.kind === "addCards" && result.createdIds) {
          markLocalCards(result.createdIds);
          op.tempIds.forEach((tempId, i) => {
            const real = result.createdIds?.[i];
            if (real) ids[tempId] = real;
          });
        }
      }
    } finally {
      laneBusy.current -= 1;
      // Also covers live changes that arrived meanwhile (refreshPending),
      // unless a new drag has started: that one refreshes when it ends.
      if ((sent || refreshPending.current) && laneBusy.current === 0 && !dragStart.current) {
        refreshPending.current = false;
        markBoardRefreshed(boardId);
        router.refresh();
      } else if (sent) {
        refreshPending.current = true;
      }
    }
    return ok;
  }

  const latestLaneHandlers: LaneHandlers = {
    toggleLane,
    setAddingCell,
    addToLane: async (column, lane, text) => {
      const titles = splitTitles(text);
      if (titles.length === 0) return false;
      const tempIds = titles.map(() => newId(TEMP_PREFIX));
      const ops: OutboxOp[] = [{ kind: "addCards", columnId: column.id, titles, tempIds }];
      tempIds.forEach((id, i) => ops.push(...laneChange(blankCard(id, titles[i], 0), group, blankLane(group), lane, lanes).ops));
      const ok = await runChain(ops, titles.join(", "));
      if (ok && titles.length > 1) ui.toast({ message: tn("cardsAdded", titles.length, locale) });
      return ok;
    },
    commit: (ops, label) => {
      runChain(ops, label);
    },
    dragStarted: (snapshot, columnId, index) => {
      dragStart.current = { snapshot, columnId, index };
    },
    dragEnded: () => finishDrag(),
  };
  const laneHandlers = useStableHandlers(latestLaneHandlers);

  // ---------- Drag and drop ----------

  const dndGate = useStableHandlers({ blocked: () => filtering });
  const [sensorOptions] = useState(() => ({
    mouse: { ...MOUSE_OPTIONS, blocked: dndGate.blocked },
    touch: { ...TOUCH_OPTIONS, blocked: dndGate.blocked },
    keyboard: { ...KEYBOARD_OPTIONS, blocked: dndGate.blocked },
  }));
  const sensors = useSensors(
    useSensor(BoardMouseSensor, sensorOptions.mouse),
    useSensor(BoardTouchSensor, sensorOptions.touch),
    useSensor(BoardKeyboardSensor, sensorOptions.keyboard)
  );

  const collisionDetection: CollisionDetection = (args) => {
    if (args.active.data.current?.type === "column") {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => isColumnKey(String(c.id))),
      });
    }
    // Find the column first, then the closest card in it. Testing all 500
    // cards on every pointer move is slow: each of dnd-kit's rects reads the
    // scroll position of all its scrollable ancestors per coordinate.
    const columnArgs = { ...args, droppableContainers: args.droppableContainers.filter((c) => isColumnKey(String(c.id))) };
    const hits = pointerWithin(columnArgs);
    const collisions = hits.length > 0 ? hits : rectIntersection(columnArgs);
    const overId = getFirstCollision(collisions, "id");
    if (overId != null) {
      const column = columns.find((c) => columnKey(c.id) === overId);
      if (column && column.cards.length > 0) {
        const ids = new Set(column.cards.map((card) => card.id));
        const inner = closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) => ids.has(String(c.id))),
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
    // No state here: the overlay reads the active item itself (DragPreview),
    // so a pick up does not re-render the whole board.
    dragStart.current = { snapshot: columns, columnId, index };
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || isColumnKey(String(active.id))) return;
    const from = containerOf(columns, active.id);
    const to = containerOf(columns, over.id);
    if (!from || !to || from === to) return;
    const target = columns.find((c) => c.id === to)!;
    const overIndex = target.cards.findIndex((c) => c.id === over.id);
    setColumns((prev) => moveCardLocally(prev, String(active.id), to, overIndex < 0 ? insertIndex(to, active) : overIndex));
  }

  function finishDrag() {
    dragStart.current = null;
    // Swimlane edits still being sent refresh when they are done (runChain).
    if (refreshPending.current && laneBusy.current === 0) {
      refreshPending.current = false;
      markBoardRefreshed(boardId);
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
      // Drops are silent, unless rules ran: their toast offers Undo.
      void offline
        .run({ kind: "move", cardId: id, toColumnId: column.id, position: index }, titleOf(id))
        .then((result) => offerRuleUndo(result.automation));
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
  const placeOf = (active: Active, overId: UniqueIdentifier) => {
    const columnId = containerOf(columns, overId);
    const column = columns.find((c) => c.id === columnId);
    if (!column) return null;
    const own = column.cards.findIndex((c) => c.id === String(active.id));
    // Over a card: its place. Over the column itself: where the card is (or
    // would go, see insertIndex).
    let i = column.cards.findIndex((c) => c.id === String(overId));
    if (i < 0) i = own >= 0 ? own : insertIndex(column.id, active);
    return { column: column.name, position: i + 1, count: column.cards.length + (own >= 0 ? 0 : 1) };
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
      const place = placeOf(active, over.id);
      return place ? tr("dndOver", { title: titleOf(active.id), ...place }) : undefined;
    },
    onDragEnd: ({ active, over }) => {
      if (!over) return tr("dndCancelled", { title: titleOf(active.id) });
      if (isColumnKey(String(active.id))) {
        const i = columns.findIndex((c) => c.id === containerOf(columns, over.id));
        return tr("dndColumnDropped", { name: titleOf(active.id), position: i + 1, count: columns.length });
      }
      const place = placeOf(active, over.id);
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
      } else if (key === "n" && !filtering && group !== "none") {
        // Into the focused cell, or the first open one.
        const cell =
          target.closest<HTMLElement>("[data-cell]")?.dataset.cell ??
          document.querySelector<HTMLElement>("[data-cell]")?.dataset.cell ??
          null;
        if (cell) {
          e.preventDefault();
          setAddingCell(cell);
        }
      } else if (key === "n" && !filtering) {
        e.preventDefault();
        setAddingColumnId(columnEl?.getAttribute("data-column-id") ?? columns[0]?.id ?? null);
      } else if (key === "e" && card) {
        e.preventDefault();
        setEditingCardId(card.id);
      } else if (group !== "none" && cardEl && ["j", "k", "h", "l", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(key)) {
        if (laneNavigate(key, cardEl)) e.preventDefault();
      } else if (["j", "k", "h", "l", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(key)) {
        const columnsEls = [...document.querySelectorAll("[data-column-id]")];
        if (!cardEl) {
          if (key === "j" || key === "ArrowDown") {
            e.preventDefault();
            focusCard(document.querySelector(VISIBLE_CARD));
          }
          return;
        }
        e.preventDefault();
        const colEl = cardEl.closest("[data-column-id]")!;
        const cards = [...colEl.querySelectorAll(VISIBLE_CARD)];
        const i = cards.indexOf(cardEl);
        if (key === "j" || key === "ArrowDown") focusCard(cards[i + 1]);
        else if (key === "k" || key === "ArrowUp") focusCard(cards[i - 1]);
        else {
          const ci = columnsEls.indexOf(colEl);
          const step = key === "h" || key === "ArrowLeft" ? -1 : 1;
          for (let c = ci + step; c >= 0 && c < columnsEls.length; c += step) {
            const next = columnsEls[c].querySelectorAll(VISIBLE_CARD);
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

  const shared = useMemo(
    () => ({
      boardId,
      locale,
      canManage,
      members,
      boardTags,
      templates,
      currentUserId,
      cardHandlers,
      columnHandlers,
    }),
    [boardId, locale, canManage, members, boardTags, templates, currentUserId, cardHandlers, columnHandlers]
  );

  // With swimlanes every cell has its own "Add card".
  const showAddBar = view === "board" && group === "none" && !filtering && columns.length > 0;
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
        {view === "board" && <GroupPicker group={group} onChange={setGroup} locale={locale} />}
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
                    .querySelector(`[data-column-id="${c.id}"], [data-lane-column="${c.id}"]`)
                    ?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })
                }
              >
                {c.name} <span className="text-ink-muted tabular-nums">{c.cards.length}</span>
              </button>
            ))}
          </nav>

          {group !== "none" ? (
            <div
              ref={boardScroller}
              className="relative -mx-4 sm:-mx-6 px-4 sm:px-6 overflow-x-auto pb-4 snap-x snap-mandatory sm:snap-none scroll-px-4"
            >
              <Swimlanes
                columns={columns}
                setColumns={setColumns}
                group={group}
                lanes={lanes}
                visibleIds={visibleIds}
                filtering={filtering}
                sensors={sensors}
                shared={shared}
                locale={locale}
                editingCardId={editingCardId}
                addingCell={addingCell}
                collapsedLanes={collapsedLanes}
                handlers={laneHandlers}
              >
                <DragPreview columns={columns} locale={locale} />
              </Swimlanes>
            </div>
          ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
            accessibility={{
              announcements,
              screenReaderInstructions: { draggable: t(filtering ? "dndInstructionsFiltered" : "dndInstructions", locale) },
            }}
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
                    editingCardId={editingCardId}
                    armed={armedColumnId === col.id}
                    dndDisabled={filtering}
                    shared={shared}
                  />
                ))}
              </SortableContext>
              {!filtering && canManage && <AddColumnForm boardId={boardId} locale={locale} guard={offline.guard} />}
            </div>
            <DragPreview columns={columns} locale={locale} />
          </DndContext>
          )}
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
      {offline.offlineCardId && (
        <OfflineCardSheet
          boardId={boardId}
          cardId={offline.offlineCardId}
          userId={currentUserId}
          locale={locale}
          fallback={offlineFallback(columns, offline.offlineCardId, {
            boardId,
            members,
            tags: boardTags,
            renderedAt: offline.dataTime,
          })}
          onClose={offline.closeOfflineCard}
        />
      )}
    </div>
  );

}

/** The board's copy of a card, shown offline when no details are stored. */
function offlineFallback(
  columns: ColumnDTO[],
  cardId: string,
  rest: Omit<BoardCardFallback, "card" | "columnName">
): BoardCardFallback | undefined {
  for (const c of columns) {
    const found = c.cards.find((cc) => cc.id === cardId);
    if (found) return { ...rest, card: found, columnName: c.name };
  }
  return undefined;
}

// The card or column under the pointer while dragging. It reads the active
// item from dnd-kit, so only this small component re-renders on pick up.
function DragPreview({ columns, locale }: { columns: ColumnDTO[]; locale: Locale }) {
  const { active } = useDndContext();
  const id = active ? String(active.id) : null;
  const activeColumn = id && isColumnKey(id) ? columns.find((c) => columnKey(c.id) === id) : null;
  const activeCard = id && !activeColumn ? columns.flatMap((c) => c.cards).find((c) => c.id === id) : null;
  return (
    // A stable wrapper: inserting the overlay straight into the space-y
    // container would restyle the whole board (sibling selectors) on every
    // pick up.
    <div className="contents">
      <DragOverlay dropAnimation={DROP_ANIMATION}>
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
    </div>
  );
}

const GROUP_LABELS = {
  none: "laneGroupNone",
  assignee: "filterAssignee",
  priority: "filterPriority",
  tag: "filterTag",
} as const;

// "Swimlanes" menu in the toolbar: no lanes, or lanes by assignee, priority or tag.
function GroupPicker({ group, onChange, locale }: { group: GroupBy; onChange: (group: GroupBy) => void; locale: Locale }) {
  return (
    <MenuTrigger>
      <AriaButton
        className={cn(
          buttonClass("secondary", "md"),
          group !== "none" && "bg-accent-soft text-accent border-accent/40"
        )}
      >
        <Rows3 size={16} aria-hidden />
        {group === "none"
          ? t("laneGroupButton", locale)
          : t("laneGroupActive", locale).replace("{group}", t(GROUP_LABELS[group], locale))}
        <ChevronDown size={14} aria-hidden className="text-ink-muted" />
      </AriaButton>
      <Popover
        placement="bottom start"
        className="min-w-[12rem] rounded-panel border border-line bg-raised text-ink shadow-float py-1 outline-none"
      >
        <AriaMenu
          aria-label={t("laneGroupLabel", locale)}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[group]}
          onSelectionChange={(keys) => {
            const next = [...(keys as Set<string>)][0];
            if (next) onChange(parseGroup(next));
          }}
          className="outline-none"
        >
          {GROUPS.map((g) => (
            <AriaMenuItem
              key={g}
              id={g}
              className="flex items-center gap-2 px-3 py-1.5 cursor-default outline-none select-none focus:bg-ink/5 hover:bg-ink/5"
            >
              {({ isSelected }) => (
                <>
                  <span className="flex-1">{t(GROUP_LABELS[g], locale)}</span>
                  {isSelected && <Check size={14} aria-hidden className="text-accent" />}
                </>
              )}
            </AriaMenuItem>
          ))}
        </AriaMenu>
      </Popover>
    </MenuTrigger>
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
