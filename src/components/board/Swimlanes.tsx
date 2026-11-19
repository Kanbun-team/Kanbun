"use client";

// The board grouped into swimlanes (?group=assignee|priority|tag). Lanes are
// rows, columns stay columns: each lane has one cell per column. Dragging a
// card into another lane changes the grouped field (src/lib/swimlanes.ts has
// the rules). The plain board (Board + Column) is untouched by this, so its
// performance work stays as it is; this file follows the same rules
// (docs/PERFORMANCE.md): memoized cells with stable props, `board-card` on
// the sortable wrapper, plain block card lists, only the cards of armed or
// visited cells as drop targets.

import { memo, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import Link from "next/link";
import {
  DndContext,
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  type Active,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type SensorDescriptor,
  type SensorOptions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import Avatar from "@/components/Avatar";
import { t, tn, type Locale } from "@/lib/i18n";
import { priorityClass, priorityLabel } from "@/lib/labels";
import TagChip from "@/components/ui/TagChip";
import { cn } from "@/lib/utils";
import { useSyncedState } from "@/lib/use-synced-state";
import type { OutboxOp } from "@/lib/outbox";
import {
  cellKey,
  columnIndexFor,
  groupCells,
  isCellKey,
  laneChange,
  parseCell,
  shareCells,
  type Cell,
  type GroupBy,
  type Lane,
} from "@/lib/swimlanes";
import { AddCardForm, ColumnCount, SortableCard, type Shared } from "./Column";
import type { CardDTO, ColumnDTO } from "./types";

const VISIBLE_CARD = "[data-card-id]:not([hidden])";

export interface LaneHandlers {
  toggleLane: (lane: string) => void;
  setAddingCell: (cellId: string | null) => void;
  /** Adds cards to a column and puts them in the lane. */
  addToLane: (column: ColumnDTO, lane: string, text: string) => Promise<boolean>;
  /** Sends the changes of a drop (or queues them offline). */
  commit: (ops: OutboxOp[], label: string) => void;
  /** A drag started: the board defers live refreshes and shortcuts until it ends. */
  dragStarted: (snapshot: ColumnDTO[], columnId: string | null, index: number) => void;
  dragEnded: () => void;
}

/** The visible name of a lane. */
export function laneName(lane: Lane, group: GroupBy, locale: Locale): string {
  switch (lane.kind) {
    case "assignee":
      return lane.member.displayName ?? lane.member.username;
    case "tag":
      return lane.tag.name;
    case "priority":
      return priorityLabel(lane.priority, locale);
    case "none":
      return t(group === "tag" ? "laneNoTag" : "laneNoAssignee", locale);
  }
}

// ---------- Keyboard ----------

// Where the last arrow key sent the dragged card: a card of its cell (to
// reorder) or another cell (with the place in it). Collision detection uses
// it while a keyboard drag runs, so the move does not depend on geometry
// (an empty cell is shorter than a card).
let keyboardTarget: { id: string; index?: number } | null = null;

/**
 * Keyboard dragging in swimlanes: Left/Right go to the neighbouring column in
 * the same lane, Up/Down reorder within the cell and continue into the lane
 * above or below at its edge, Shift+Up/Down jump to the lane above or below.
 * Collapsed lanes are skipped. Reads the board from the DOM, so the sensor
 * options can stay a module constant (see Board).
 */
export const laneKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const { active, over } = context;
  if (!active || !event.code.startsWith("Arrow")) return undefined;
  event.preventDefault();
  const cardEl = document.querySelector<HTMLElement>(`[data-cell] [data-card-id="${CSS.escape(String(active.id))}"]`);
  const cellEl = cardEl?.closest<HTMLElement>("[data-cell]");
  if (!cardEl || !cellEl) return undefined;
  const lane = cellEl.dataset.lane ?? "";
  const columnId = cellEl.dataset.cellColumn ?? "";
  const toCell = (el: HTMLElement | null | undefined, index: number) => {
    if (!el) return undefined;
    keyboardTarget = { id: el.dataset.cell ?? "", index };
    const r = el.getBoundingClientRect();
    return { x: r.left + 8, y: r.top + 8 };
  };
  const laneCell = (step: number) => {
    const rows = [...document.querySelectorAll<HTMLElement>("[data-lane-row]")];
    const at = rows.findIndex((r) => r.dataset.laneRow === lane);
    for (let i = at + step; at >= 0 && i >= 0 && i < rows.length; i += step) {
      const el = rows[i].querySelector<HTMLElement>(`[data-cell][data-cell-column="${CSS.escape(columnId)}"]`);
      if (el) return el;
    }
    return null;
  };
  if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
    const row = [...document.querySelectorAll<HTMLElement>(`[data-cell][data-lane="${CSS.escape(lane)}"]`)];
    return toCell(row[row.indexOf(cellEl) + (event.code === "ArrowRight" ? 1 : -1)], 0);
  }
  const down = event.code === "ArrowDown";
  if (!down && event.code !== "ArrowUp") return undefined;
  const step = down ? 1 : -1;
  if (event.shiftKey) return toCell(laneCell(step), down ? 0 : Number.MAX_SAFE_INTEGER);
  const cards = [...cellEl.querySelectorAll<HTMLElement>(VISIBLE_CARD)];
  let i = over ? cards.findIndex((c) => c.dataset.cardId === String(over.id)) : -1;
  if (i < 0) i = cards.indexOf(cardEl);
  const next = cards[i + step];
  if (!next) return toCell(laneCell(step), down ? 0 : Number.MAX_SAFE_INTEGER);
  keyboardTarget = { id: next.dataset.cardId ?? "" };
  const r = next.getBoundingClientRect();
  return { x: r.left, y: r.top };
};

/**
 * j/k/h/l and the arrow keys outside a drag: j/k move through a cell and on
 * into the same column of the next or previous lane, h/l to the neighbouring
 * column of the lane. Returns false when the key is not handled.
 */
export function laneNavigate(key: string, cardEl: Element): boolean {
  const focus = (el: Element | undefined) => (el?.querySelector("a") as HTMLElement | null)?.focus();
  const cellEl = cardEl.closest<HTMLElement>("[data-cell]");
  if (!cellEl) return false;
  const cards = [...cellEl.querySelectorAll(VISIBLE_CARD)];
  const i = cards.indexOf(cardEl);
  const vertical = key === "j" || key === "ArrowDown" ? 1 : key === "k" || key === "ArrowUp" ? -1 : 0;
  if (vertical) {
    if (cards[i + vertical]) {
      focus(cards[i + vertical]);
      return true;
    }
    const sameColumn = [...document.querySelectorAll(`[data-cell][data-cell-column="${CSS.escape(cellEl.dataset.cellColumn ?? "")}"]`)];
    for (let c = sameColumn.indexOf(cellEl) + vertical; c >= 0 && c < sameColumn.length; c += vertical) {
      const list = sameColumn[c].querySelectorAll(VISIBLE_CARD);
      if (list.length) {
        focus(vertical > 0 ? list[0] : list[list.length - 1]);
        break;
      }
    }
    return true;
  }
  const step = key === "h" || key === "ArrowLeft" ? -1 : 1;
  const row = [...document.querySelectorAll(`[data-cell][data-lane="${CSS.escape(cellEl.dataset.lane ?? "")}"]`)];
  for (let c = row.indexOf(cellEl) + step; c >= 0 && c < row.length; c += step) {
    const list = row[c].querySelectorAll(VISIBLE_CARD);
    if (list.length) {
      focus(list[Math.min(i, list.length - 1)]);
      break;
    }
  }
  return true;
}

// ---------- Board ----------

/** Where a card dragged over a cell (not one of its cards) goes, from the DOM (see Board insertIndex). */
function insertIndex(cellId: string, active: Active): number {
  const cards = document.querySelectorAll(`[data-cell="${CSS.escape(cellId)}"] ${VISIBLE_CARD}`);
  const rect = active.rect.current.translated;
  if (!rect) return cards.length;
  const middle = rect.top + rect.height / 2;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (middle < r.top + r.height / 2) return i;
  }
  return cards.length;
}

function moveCardLocally(columns: ColumnDTO[], cardId: string, toColumnId: string, index: number, patch?: Partial<CardDTO>): ColumnDTO[] {
  let moved: CardDTO | undefined;
  const without = columns.map((c) => {
    const i = c.cards.findIndex((card) => card.id === cardId);
    if (i < 0) return c;
    moved = c.cards[i];
    return { ...c, cards: c.cards.filter((card) => card.id !== cardId) };
  });
  if (!moved) return columns;
  const card = patch && Object.keys(patch).length > 0 ? { ...moved, ...patch } : moved;
  return without.map((c) => {
    if (c.id !== toColumnId) return c;
    const cards = [...c.cards];
    cards.splice(Math.max(0, Math.min(index, cards.length)), 0, card);
    return { ...c, cards };
  });
}

export default function Swimlanes({
  columns,
  setColumns,
  group,
  lanes,
  visibleIds,
  filtering,
  sensors,
  shared,
  locale,
  editingCardId,
  addingCell,
  collapsedLanes,
  handlers,
  children,
}: {
  columns: ColumnDTO[];
  setColumns: Dispatch<SetStateAction<ColumnDTO[]>>;
  group: GroupBy;
  lanes: Lane[];
  /** Cards that match the filter, or null when not filtering. */
  visibleIds: Set<string> | null;
  filtering: boolean;
  sensors: SensorDescriptor<SensorOptions>[];
  shared: Shared;
  locale: Locale;
  editingCardId: string | null;
  addingCell: string | null;
  collapsedLanes: Set<string>;
  handlers: LaneHandlers;
  /** The drag preview, rendered inside the drag and drop context. */
  children?: ReactNode;
}) {
  // The dragged card stays in the lane it was dragged to until it is dropped,
  // whatever its fields say (they only change on drop).
  const [override, setOverride] = useState<{ cardId: string; lane: string } | null>(null);
  const [armedCell, setArmedCell] = useState<string | null>(null);
  const start = useRef<{ snapshot: ColumnDTO[]; lane: string; columnId: string; index: number } | null>(null);
  const computed = useMemo(() => groupCells(columns, lanes, group, override), [columns, lanes, group, override]);
  // Unchanged cells keep their objects, so their memoized components skip.
  const [grouping] = useSyncedState(computed, shareCells);
  const names = useMemo(() => new Map(lanes.map((l) => [l.key, laneName(l, group, locale)])), [lanes, group, locale]);

  const cellCards = (id: string) => grouping.cells.get(id)?.cards ?? [];
  const cellOfId = (id: UniqueIdentifier): string | null => {
    const key = String(id);
    return isCellKey(key) ? key : grouping.cellOf.get(key) ?? null;
  };
  const findCard = (id: string) => {
    for (const c of columns) {
      const card = c.cards.find((x) => x.id === id);
      if (card) return card;
    }
    return undefined;
  };

  const collisionDetection: CollisionDetection = (args) => {
    if (keyboardTarget && args.droppableContainers.some((c) => c.id === keyboardTarget!.id)) {
      return [{ id: keyboardTarget.id }];
    }
    // The cell first, then the closest card in it (see Board).
    const cellArgs = { ...args, droppableContainers: args.droppableContainers.filter((c) => isCellKey(String(c.id))) };
    const hits = pointerWithin(cellArgs);
    const collisions = hits.length > 0 ? hits : rectIntersection(cellArgs);
    const overId = getFirstCollision(collisions, "id");
    if (overId != null) {
      const ids = new Set(cellCards(String(overId)).map((c) => c.id));
      if (ids.size > 0) {
        const inner = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => ids.has(String(c.id))) });
        if (inner.length > 0) return inner;
      }
    }
    return collisions;
  };

  function onDragStart({ active }: DragStartEvent) {
    keyboardTarget = null;
    const id = String(active.id);
    const cell = parseCell(grouping.cellOf.get(id) ?? "");
    const column = columns.find((c) => c.id === cell?.columnId);
    const index = column ? column.cards.findIndex((c) => c.id === id) : -1;
    start.current = cell ? { snapshot: columns, lane: cell.lane, columnId: cell.columnId, index } : null;
    handlers.dragStarted(columns, cell?.columnId ?? null, index);
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const id = String(active.id);
    const from = grouping.cellOf.get(id);
    const to = cellOfId(over.id);
    if (!from || !to || from === to) return;
    const target = parseCell(to);
    const column = columns.find((c) => c.id === target?.columnId);
    if (!target || !column) return;
    const inCell = cellCards(to).filter((c) => c.id !== id);
    const overIndex = inCell.findIndex((c) => c.id === String(over.id));
    const wanted =
      overIndex >= 0
        ? overIndex
        : keyboardTarget?.id === to && keyboardTarget.index !== undefined
          ? Math.min(keyboardTarget.index, inCell.length)
          : insertIndex(to, active);
    const columnCards = column.cards.filter((c) => c.id !== id);
    const stays = column.cards.some((c) => c.id === id) ? column.cards.findIndex((c) => c.id === id) : undefined;
    const index = columnIndexFor(columnCards, inCell, wanted, stays);
    setColumns((prev) => moveCardLocally(prev, id, column.id, index));
    setOverride({ cardId: id, lane: target.lane });
  }

  function finish() {
    keyboardTarget = null;
    setOverride(null);
    start.current = null;
    handlers.dragEnded();
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id);
    const begin = start.current;
    const cellId = grouping.cellOf.get(id);
    const cell = parseCell(cellId ?? "");
    const card = findCard(id);
    if (!over || !begin || !cell || !cellId || !card) {
      if (begin) setColumns(begin.snapshot);
      finish();
      return;
    }
    const column = columns.find((c) => c.id === cell.columnId)!;
    const inCell = cellCards(cellId);
    const from = inCell.findIndex((c) => c.id === id);
    const to = inCell.findIndex((c) => c.id === String(over.id));
    let index = column.cards.findIndex((c) => c.id === id);
    if (to >= 0 && from >= 0 && to !== from) {
      const others = arrayMove(inCell, from, to).filter((c) => c.id !== id);
      index = columnIndexFor(
        column.cards.filter((c) => c.id !== id),
        others,
        to
      );
    }
    const change = laneChange(card, group, begin.lane, cell.lane, lanes);
    const ops: OutboxOp[] = [];
    if (column.id !== begin.columnId || index !== begin.index) {
      ops.push({ kind: "move", cardId: id, toColumnId: column.id, position: index });
    }
    ops.push(...change.ops);
    // The card keeps its place and gets its new fields in the same update
    // that ends the drag, so it does not jump back for a frame.
    // Sent before the drag ends, so a live refresh that waited for the drag
    // waits for these edits too instead of showing them half done.
    if (ops.length > 0) {
      setColumns((prev) => moveCardLocally(prev, id, column.id, index, change.patch));
      handlers.commit(ops, card.title);
    }
    finish();
  }

  function onDragCancel() {
    if (start.current) setColumns(start.current.snapshot);
    finish();
  }

  // ---------- Announcements ----------

  const tr = (key: Parameters<typeof t>[0], vars: Record<string, string | number>) =>
    Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), t(key, locale));
  const titleOf = (id: UniqueIdentifier) => findCard(String(id))?.title ?? "";
  const placeOf = (active: Active, overId: UniqueIdentifier) => {
    const cellId = cellOfId(overId);
    const cell = parseCell(cellId ?? "");
    const column = columns.find((c) => c.id === cell?.columnId);
    if (!cellId || !cell || !column) return null;
    const cards = cellCards(cellId);
    const own = cards.findIndex((c) => c.id === String(active.id));
    let i = cards.findIndex((c) => c.id === String(overId));
    if (i < 0) i = own >= 0 ? own : insertIndex(cellId, active);
    return {
      column: column.name,
      lane: names.get(cell.lane) ?? "",
      position: i + 1,
      count: cards.length + (own >= 0 ? 0 : 1),
    };
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => tr("dndPickedUp", { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) => {
      const place = over ? placeOf(active, over.id) : null;
      return place ? tr("laneDndOver", { title: titleOf(active.id), ...place }) : undefined;
    },
    onDragEnd: ({ active, over }) => {
      if (!over) return tr("dndCancelled", { title: titleOf(active.id) });
      const place = placeOf(active, over.id);
      return place ? tr("laneDndDropped", { title: titleOf(active.id), ...place }) : undefined;
    },
    onDragCancel: ({ active }) => tr("dndCancelled", { title: titleOf(active.id) }),
  };

  const laneCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [id, cell] of grouping.cells) {
      const lane = parseCell(id)?.lane ?? "";
      const visible = (c: CardDTO) => !visibleIds || visibleIds.has(c.id);
      const n = cell.cards.filter(visible).length + cell.copies.filter((copy) => visible(copy.card)).length;
      counts.set(lane, (counts.get(lane) ?? 0) + n);
    }
    return counts;
  }, [grouping, visibleIds]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t(filtering ? "dndInstructionsFiltered" : "laneDndInstructions", locale) },
      }}
    >
      <div data-swimlanes={group} className="w-max space-y-3">
        <div className="flex gap-3">
          {columns.map((column) => (
            <div
              key={column.id}
              data-lane-column={column.id}
              className="shrink-0 w-[85vw] sm:w-72 snap-start flex items-center gap-1 px-3 py-1.5 bg-surface border border-line rounded-panel"
            >
              <h2 className="flex-1 min-w-0 font-semibold truncate">{column.name}</h2>
              <ColumnCount count={column.cards.length} wipLimit={column.wipLimit} locale={locale} />
            </div>
          ))}
        </div>
        {lanes.map((lane) => {
          const collapsed = collapsedLanes.has(lane.key) && !(override && override.lane === lane.key);
          const name = names.get(lane.key) ?? "";
          const count = laneCounts.get(lane.key) ?? 0;
          return (
            <section key={lane.key} aria-label={name} data-lane-row={lane.key} className="space-y-2">
              <h2 className="sticky left-0 w-fit max-w-[calc(100vw-2rem)]">
                <button
                  type="button"
                  aria-expanded={!collapsed}
                  onClick={() => handlers.toggleLane(lane.key)}
                  className="flex items-center gap-2 rounded-control px-1.5 py-1 font-semibold hover:bg-ink/5 outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {collapsed ? <ChevronRight size={16} aria-hidden className="text-ink-muted" /> : <ChevronDown size={16} aria-hidden className="text-ink-muted" />}
                  <LaneIcon lane={lane} name={name} />
                  {lane.kind === "tag" ? <TagChip name={name} color={lane.tag.color} className="text-sm" /> : <span className="truncate">{name}</span>}
                  <span className="text-sm font-normal text-ink-muted tabular-nums" aria-hidden>
                    {count}
                  </span>
                  <span className="sr-only">, {tn("laneCards", count, locale)}</span>
                </button>
              </h2>
              {!collapsed && (
                <div className="flex items-start gap-3">
                  {columns.map((column) => {
                    const id = cellKey(column.id, lane.key);
                    return (
                      <LaneCell
                        key={id}
                        id={id}
                        column={column}
                        lane={lane.key}
                        laneLabel={name}
                        cell={grouping.cells.get(id) ?? EMPTY_CELL}
                        names={names}
                        visibleIds={visibleIds}
                        armed={armedCell === id}
                        arm={setArmedCell}
                        editingCardId={editingCardId}
                        adding={addingCell === id}
                        dndDisabled={filtering}
                        shared={shared}
                        handlers={handlers}
                      />
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {children}
    </DndContext>
  );
}

const EMPTY_CELL: Cell = { cards: [], copies: [] };

function LaneIcon({ lane, name }: { lane: Lane; name: string }) {
  if (lane.kind === "assignee") return <Avatar src={lane.member.avatarUrl} name={name} size={20} decorative />;
  if (lane.kind === "priority") return <span aria-hidden className={cn("w-1 h-4 rounded-full shrink-0", priorityClass(lane.priority))} />;
  return null;
}

const CELL_DATA = { type: "cell" };

// The cell reads dnd-kit's context (it re-renders during drags); its content
// only when its own props change.
const LaneCell = memo(function LaneCell({
  id,
  column,
  lane,
  laneLabel,
  cell,
  names,
  visibleIds,
  armed,
  arm,
  editingCardId,
  adding,
  dndDisabled,
  shared,
  handlers,
}: {
  id: string;
  column: ColumnDTO;
  lane: string;
  laneLabel: string;
  cell: Cell;
  names: Map<string, string>;
  visibleIds: Set<string> | null;
  armed: boolean;
  arm: (id: string) => void;
  editingCardId: string | null;
  adding: boolean;
  dndDisabled: boolean;
  shared: Shared;
  handlers: LaneHandlers;
}) {
  const { setNodeRef, active } = useDroppable({ id, data: CELL_DATA });
  // Drop targets, as in Column: the cards of the armed cell and of cells the
  // dragged card has been in.
  const holdsActive = active != null && cell.cards.some((c) => c.id === active.id);
  const [visited, setVisited] = useState(false);
  if (holdsActive && !visited) setVisited(true);
  if (!active && visited) setVisited(false);
  const onArm = () => {
    if (!armed) arm(id);
  };
  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={`${column.name}, ${laneLabel}`}
      data-cell={id}
      data-cell-column={column.id}
      data-lane={lane}
      onFocusCapture={onArm}
      onPointerDownCapture={onArm}
      className="group/cell shrink-0 w-[85vw] sm:w-72 snap-start bg-surface border border-line rounded-panel px-2 py-2 space-y-2 min-h-12"
    >
      <CellContent
        id={id}
        column={column}
        lane={lane}
        cell={cell}
        names={names}
        visibleIds={visibleIds}
        droppable={armed || holdsActive || visited}
        editingCardId={editingCardId}
        adding={adding}
        dndDisabled={dndDisabled}
        shared={shared}
        handlers={handlers}
      />
    </div>
  );
});

const CellContent = memo(function CellContent({
  id,
  column,
  lane,
  cell,
  names,
  visibleIds,
  droppable,
  editingCardId,
  adding,
  dndDisabled,
  shared,
  handlers,
}: {
  id: string;
  column: ColumnDTO;
  lane: string;
  cell: Cell;
  names: Map<string, string>;
  visibleIds: Set<string> | null;
  droppable: boolean;
  editingCardId: string | null;
  adding: boolean;
  dndDisabled: boolean;
  shared: Shared;
  handlers: LaneHandlers;
}) {
  const { locale, boardId } = shared;
  const ids = useMemo(() => cell.cards.map((c) => c.id), [cell.cards]);
  const copies = visibleIds ? cell.copies.filter((copy) => visibleIds.has(copy.card.id)) : cell.copies;
  return (
    <>
      <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
        {cell.cards.map((card) => (
          <SortableCard
            key={card.id}
            card={card}
            columnId={column.id}
            editing={editingCardId === card.id}
            droppable={droppable}
            hidden={visibleIds != null && !visibleIds.has(card.id)}
            shared={shared}
          />
        ))}
      </SortableContext>
      {copies.map(({ card, from }) => (
        <Link
          key={card.id}
          href={`/tasks/${boardId}/cards/${card.id}`}
          scroll={false}
          prefetch={false}
          data-copy-of={card.id}
          className="block rounded-card border border-dashed border-line-strong px-3 py-2 outline-none hover:border-ink-muted focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="block font-medium line-clamp-2">{card.title}</span>
          <span className="block text-sm text-ink-muted">
            {t("laneCopyHint", locale).replace("{lane}", names.get(from) ?? "")}
          </span>
        </Link>
      ))}
      {!dndDisabled &&
        (adding ? (
          <AddCardForm
            column={column}
            locale={locale}
            onAdd={(c, text) => handlers.addToLane(c, lane, text)}
            onClose={() => handlers.setAddingCell(null)}
          />
        ) : (
          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-card px-2 py-1.5 text-ink-muted hover:text-ink hover:bg-ink/5 transition-opacity sm:opacity-0 sm:group-hover/cell:opacity-100 focus-visible:opacity-100"
            onClick={() => handlers.setAddingCell(id)}
          >
            <Plus size={16} aria-hidden />
            {t("cardAdd", locale)}
          </button>
        ))}
    </>
  );
});
