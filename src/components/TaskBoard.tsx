"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Avatar from "./Avatar";
import { cn } from "@/lib/utils";
import { PRIORITIES, priorityClass, priorityLabel } from "@/lib/labels";
import { t, type Locale, formatDate } from "@/lib/i18n";
import {
  addCardAction,
  addColumnAction,
  deleteCardAction,
  deleteColumnAction,
  moveCardAction,
  renameColumnAction,
  toggleAssigneeAction,
  toggleCardTagAction,
  updateCardAction,
} from "@/server/tasks-actions";

export interface MemberOption {
  id: string;
  displayName: string | null;
  username: string;
  avatarUrl: string | null;
}

export interface TagOption {
  id: string;
  name: string;
  color: string;
}

const COVER_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#16a34a",
  "#dc2626",
  "#ea580c",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#475569",
];

export interface CardDTO {
  id: string;
  title: string;
  priority: string;
  coverColor: string | null;
  deadline: string | null;
  position: number;
  assignees: { id: string; displayName: string | null; username: string; avatarUrl: string | null }[];
  tags: { id: string; name: string; color: string }[];
  subtasksTotal: number;
  subtasksDone: number;
  commentsCount: number;
  blockedByCount: number;
}

export interface ColumnDTO {
  id: string;
  name: string;
  position: number;
  wipLimit: number | null;
  cards: CardDTO[];
}

export interface TaskBoardProps {
  boardId: string;
  columns: ColumnDTO[];
  locale: Locale;
  canManage: boolean;
  currentUserId: string;
  members: MemberOption[];
  boardTags: TagOption[];
}

interface Filters {
  query: string;
  assigneeId: string;
  tagId: string;
  priority: string;
  deadline: "" | "overdue" | "has" | "none";
  mine: boolean;
}

const EMPTY_FILTERS: Filters = {
  query: "",
  assigneeId: "",
  tagId: "",
  priority: "",
  deadline: "",
  mine: false,
};

export default function TaskBoard({
  boardId,
  columns: initialColumns,
  locale,
  canManage,
  currentUserId,
  members,
  boardTags,
}: TaskBoardProps) {
  const [columns, setColumns] = useState(initialColumns);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ columnId: string; index: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; cardId: string } | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => setColumns(initialColumns), [initialColumns]);

  // Live updates: when anyone mutates this board, the server pushes an SSE
  // event and we re-fetch. Refreshes are debounced so a burst of changes
  // (e.g. someone reordering several cards) collapses into one round-trip.
  useEffect(() => {
    const source = new EventSource(`/api/boards/${boardId}/events`);
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
  }, [boardId, router]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  const allCards = useMemo(() => columns.flatMap((c) => c.cards), [columns]);

  // Filter options are derived from the cards currently on the board, so the
  // dropdowns only ever offer values that can actually match something.
  const assigneeOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const card of allCards) {
      for (const u of card.assignees) {
        if (!map.has(u.id)) map.set(u.id, { id: u.id, name: u.displayName ?? u.username });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allCards]);

  const tagOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const card of allCards) {
      for (const tag of card.tags) {
        if (!map.has(tag.id)) map.set(tag.id, { id: tag.id, name: tag.name });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allCards]);

  const filtering =
    filters.query.trim() !== "" ||
    filters.assigneeId !== "" ||
    filters.tagId !== "" ||
    filters.priority !== "" ||
    filters.deadline !== "" ||
    filters.mine;

  const matches = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return (card: CardDTO): boolean => {
      if (q && !card.title.toLowerCase().includes(q)) return false;
      if (filters.assigneeId && !card.assignees.some((u) => u.id === filters.assigneeId)) return false;
      if (filters.mine && !card.assignees.some((u) => u.id === currentUserId)) return false;
      if (filters.tagId && !card.tags.some((tg) => tg.id === filters.tagId)) return false;
      if (filters.priority && card.priority !== filters.priority) return false;
      if (filters.deadline === "none" && card.deadline) return false;
      if (filters.deadline === "has" && !card.deadline) return false;
      if (filters.deadline === "overdue") {
        if (!card.deadline || new Date(card.deadline).getTime() >= Date.now()) return false;
      }
      return true;
    };
  }, [filters, currentUserId]);

  const visibleColumns = useMemo(
    () => (filtering ? columns.map((c) => ({ ...c, cards: c.cards.filter(matches) })) : columns),
    [columns, filtering, matches]
  );

  const visibleCount = useMemo(
    () => visibleColumns.reduce((n, c) => n + c.cards.length, 0),
    [visibleColumns]
  );

  // Real per-column counts (unaffected by filtering) drive the WIP indicator.
  const realCounts = useMemo(
    () => new Map(columns.map((c) => [c.id, c.cards.length])),
    [columns]
  );

  function handleDragStart(cardId: string) {
    setDragCardId(cardId);
  }
  function handleDragEnd() {
    setDragCardId(null);
    setDragOver(null);
  }

  function localMove(cardId: string, toColumnId: string, position: number) {
    setColumns((prev) => {
      const next = prev.map((c) => ({ ...c, cards: [...c.cards] }));
      let card: CardDTO | null = null;
      for (const col of next) {
        const idx = col.cards.findIndex((cc) => cc.id === cardId);
        if (idx >= 0) {
          card = col.cards[idx];
          col.cards.splice(idx, 1);
          break;
        }
      }
      if (!card) return prev;
      const target = next.find((c) => c.id === toColumnId);
      if (!target) return prev;
      const bounded = Math.max(0, Math.min(position, target.cards.length));
      target.cards.splice(bounded, 0, card);
      return next;
    });
  }

  async function handleDrop(toColumnId: string, position: number) {
    if (!dragCardId) return;
    localMove(dragCardId, toColumnId, position);
    const cardId = dragCardId;
    setDragCardId(null);
    setDragOver(null);
    startTransition(async () => {
      try {
        await moveCardAction({ cardId, toColumnId, position });
      } finally {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        assigneeOptions={assigneeOptions}
        tagOptions={tagOptions}
        filtering={filtering}
        visibleCount={visibleCount}
        locale={locale}
      />
      <div className="flex items-start gap-4 overflow-x-auto pb-2 scroll-shadow snap-x">
        {visibleColumns.map((col) => (
          <div
            key={col.id}
            className="surface border rounded-xl w-80 shrink-0 snap-start flex flex-col max-h-[80vh]"
            onDragOver={(e) => {
              if (filtering) return;
              e.preventDefault();
              setDragOver({ columnId: col.id, index: col.cards.length });
            }}
            onDrop={(e) => {
              if (filtering) return;
              e.preventDefault();
              const idx = dragOver?.columnId === col.id ? dragOver.index : col.cards.length;
              handleDrop(col.id, idx);
            }}
          >
            <ColumnHeader
              column={col}
              count={realCounts.get(col.id) ?? col.cards.length}
              locale={locale}
              canManage={canManage}
              boardId={boardId}
            />
            <div className="px-2 py-1 flex-1 overflow-y-auto space-y-2">
              {col.cards.map((card, i) => (
                <div
                  key={card.id}
                  onDragOver={(e) => {
                    if (filtering) return;
                    e.preventDefault();
                    setDragOver({ columnId: col.id, index: i });
                  }}
                >
                  {!filtering && dragOver?.columnId === col.id && dragOver.index === i && (
                    <div className="h-1.5 rounded bg-brand-500/60 my-1" />
                  )}
                  <CardItem
                    boardId={boardId}
                    card={card}
                    locale={locale}
                    draggable={!filtering}
                    onDragStart={() => handleDragStart(card.id)}
                    onDragEnd={handleDragEnd}
                    onContextMenu={(x, y) => setContextMenu({ x, y, cardId: card.id })}
                  />
                </div>
              ))}
              {!filtering && dragOver?.columnId === col.id && dragOver.index >= col.cards.length && (
                <div className="h-1.5 rounded bg-brand-500/60 my-1" />
              )}
              {!filtering && <AddCardForm columnId={col.id} locale={locale} />}
            </div>
          </div>
        ))}
        {!filtering && canManage && <AddColumnForm boardId={boardId} locale={locale} />}
      </div>
      {filtering && visibleCount === 0 && (
        <p className="text-sm opacity-60 px-1">{t("filterNoMatch", locale)}</p>
      )}
      {contextMenu && (
        <CardContextMenu
          locale={locale}
          card={allCards.find((c) => c.id === contextMenu.cardId)!}
          members={members}
          boardTags={boardTags}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

function FilterBar({
  filters,
  setFilters,
  assigneeOptions,
  tagOptions,
  filtering,
  visibleCount,
  locale,
}: {
  filters: Filters;
  setFilters: (next: Filters) => void;
  assigneeOptions: { id: string; name: string }[];
  tagOptions: { id: string; name: string }[];
  filtering: boolean;
  visibleCount: number;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const activeCount =
    (filters.query.trim() ? 1 : 0) +
    (filters.assigneeId ? 1 : 0) +
    (filters.tagId ? 1 : 0) +
    (filters.priority ? 1 : 0) +
    (filters.deadline ? 1 : 0) +
    (filters.mine ? 1 : 0);

  const selectClass =
    "!py-1 !text-sm w-full rounded-md border border-[var(--border)] bg-transparent";
  const fieldLabel = "block text-xs uppercase tracking-wide opacity-50 mb-1";

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-2 rounded-md text-sm px-3 py-1.5 border transition",
          filtering
            ? "border-brand-500 text-brand-600"
            : "border-[var(--border)] opacity-80 hover:opacity-100"
        )}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
        {t("filter", locale)}
        {activeCount > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-[11px] font-semibold flex items-center justify-center">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-2 w-72 surface border rounded-xl shadow-xl p-3 space-y-3">
          <div>
            <input
              type="search"
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              placeholder={t("filterSearchPlaceholder", locale)}
              autoFocus
              className="!py-1 !text-sm w-full"
            />
          </div>
          <div>
            <label className={fieldLabel}>{t("filterAssignee", locale)}</label>
            <select
              value={filters.assigneeId}
              onChange={(e) => setFilters({ ...filters, assigneeId: e.target.value, mine: false })}
              className={selectClass}
            >
              <option value="">{t("filterAll", locale)}</option>
              {assigneeOptions.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={fieldLabel}>{t("filterTag", locale)}</label>
            <select
              value={filters.tagId}
              onChange={(e) => setFilters({ ...filters, tagId: e.target.value })}
              className={selectClass}
            >
              <option value="">{t("filterAll", locale)}</option>
              {tagOptions.map((tg) => (
                <option key={tg.id} value={tg.id}>{tg.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={fieldLabel}>{t("filterPriority", locale)}</label>
            <select
              value={filters.priority}
              onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
              className={selectClass}
            >
              <option value="">{t("filterAll", locale)}</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{priorityLabel(p, locale)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={fieldLabel}>{t("filterDeadline", locale)}</label>
            <select
              value={filters.deadline}
              onChange={(e) => setFilters({ ...filters, deadline: e.target.value as Filters["deadline"] })}
              className={selectClass}
            >
              <option value="">{t("filterAll", locale)}</option>
              <option value="overdue">{t("cardOverdue", locale)}</option>
              <option value="has">{t("filterHasDeadline", locale)}</option>
              <option value="none">{t("cardNoDeadline", locale)}</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => setFilters({ ...filters, mine: !filters.mine, assigneeId: "" })}
            aria-pressed={filters.mine}
            className={cn(
              "w-full rounded-md text-sm px-2.5 py-1.5 border transition",
              filters.mine
                ? "bg-brand-600 text-white border-transparent"
                : "border-[var(--border)] opacity-80 hover:opacity-100"
            )}
          >
            {t("filterAssignedToMe", locale)}
          </button>
          {filtering && (
            <div className="flex items-center justify-between pt-1 border-t border-[var(--border)]">
              <span className="text-xs opacity-60">{visibleCount}</span>
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="text-sm opacity-70 hover:opacity-100"
              >
                {t("filterClear", locale)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ColumnHeader({
  column,
  count,
  locale,
  canManage,
  boardId,
}: {
  column: ColumnDTO;
  count: number;
  locale: Locale;
  canManage: boolean;
  boardId: string;
}) {
  const [editing, setEditing] = useState(false);
  const over = column.wipLimit != null && count > column.wipLimit;
  return (
    <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-2">
      {editing ? (
        <form
          action={async (fd) => {
            await renameColumnAction(fd);
            setEditing(false);
          }}
          className="flex-1 flex flex-wrap gap-2"
        >
          <input type="hidden" name="columnId" value={column.id} />
          <input
            name="name"
            defaultValue={column.name}
            autoFocus
            maxLength={80}
            className="!py-1 flex-1 min-w-0"
          />
          <input
            type="number"
            name="wipLimit"
            min={1}
            max={999}
            defaultValue={column.wipLimit ?? ""}
            placeholder={t("columnWipLimit", locale)}
            title={t("columnWipLimit", locale)}
            className="!py-1 w-16"
          />
          <button className="text-sm rounded bg-brand-600 hover:bg-brand-700 text-white px-2">
            {t("save", locale)}
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            className="font-semibold text-left flex-1 truncate"
            onClick={() => setEditing(true)}
            title={column.name}
          >
            {column.name}
          </button>
          <span
            className={cn(
              "text-xs tabular-nums",
              over ? "text-red-500 font-semibold" : "opacity-60"
            )}
            title={column.wipLimit != null ? t("columnWipLimit", locale) : undefined}
          >
            {count}
            {column.wipLimit != null && `/${column.wipLimit}`}
          </span>
          {canManage && (
            <form action={deleteColumnAction}>
              <input type="hidden" name="columnId" value={column.id} />
              <button
                type="submit"
                className="text-xs opacity-60 hover:opacity-100 px-1"
                title={t("columnDelete", locale)}
              >
                &times;
              </button>
            </form>
          )}
        </>
      )}
      <div className="hidden" data-board-id={boardId} />
    </div>
  );
}

function AddCardForm({ columnId, locale }: { columnId: string; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  if (!open) {
    return (
      <button
        type="button"
        className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] py-2 text-sm font-medium opacity-60 hover:opacity-100 hover:border-brand-500 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition"
        onClick={() => setOpen(true)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {t("cardAdd", locale)}
      </button>
    );
  }
  return (
    <form
      ref={ref}
      action={async (fd) => {
        await addCardAction(fd);
        ref.current?.reset();
        // Keep the form open and focused so the next task can be typed right away.
        titleRef.current?.focus();
      }}
      className="space-y-2"
    >
      <input type="hidden" name="columnId" value={columnId} />
      <textarea
        ref={titleRef}
        name="title"
        required
        maxLength={200}
        rows={2}
        autoFocus
        placeholder={t("cardTitle", locale)}
        className="w-full"
        onKeyDown={(e) => {
          // Enter saves and starts a new task; Shift+Enter inserts a newline.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="flex gap-2">
        <button className="rounded bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-1">
          {t("add", locale)}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm px-3 py-1 opacity-70 hover:opacity-100"
        >
          {t("cancel", locale)}
        </button>
      </div>
    </form>
  );
}

function AddColumnForm({ boardId, locale }: { boardId: string; locale: Locale }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <div className="w-72 shrink-0">
      {open ? (
        <form
          ref={ref}
          action={async (fd) => {
            await addColumnAction(fd);
            ref.current?.reset();
            setOpen(false);
          }}
          className="surface border rounded-xl p-3 space-y-2"
        >
          <input type="hidden" name="boardId" value={boardId} />
          <input
            name="name"
            required
            maxLength={80}
            autoFocus
            placeholder={t("columnName", locale)}
          />
          <div className="flex gap-2">
            <button className="rounded bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-1">
              {t("add", locale)}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm px-3 py-1 opacity-70 hover:opacity-100"
            >
              {t("cancel", locale)}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-left p-3 rounded-xl border border-dashed border-[var(--border)] hover:border-brand-500"
        >
          + {t("columnAdd", locale)}
        </button>
      )}
    </div>
  );
}

function CardItem({
  boardId,
  card,
  locale,
  draggable,
  onDragStart,
  onDragEnd,
  onContextMenu,
}: {
  boardId: string;
  card: CardDTO;
  locale: Locale;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const overdue = card.deadline && new Date(card.deadline).getTime() < Date.now();
  return (
    <Link
      href={`/tasks/${boardId}/cards/${card.id}`}
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", card.id);
              onDragStart();
            }
          : undefined
      }
      onDragEnd={draggable ? onDragEnd : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      className="block surface border rounded-lg p-3 hover:border-brand-500 transition shadow-sm overflow-hidden"
    >
      {card.coverColor && (
        <div
          className="-mx-3 -mt-3 mb-2 h-1.5"
          style={{ background: card.coverColor }}
          aria-hidden="true"
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium leading-snug">{card.title}</div>
      </div>
      {card.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {card.tags.map((tag) => (
            <span
              key={tag.id}
              className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold"
              style={{ background: tag.color + "33", color: tag.color }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1 flex-wrap">
          <span className={cn("rounded px-1.5 py-0.5 font-medium", priorityClass(card.priority))}>
            {priorityLabel(card.priority, locale)}
          </span>
          {card.deadline && (
            <span className={cn("opacity-80", overdue && "text-red-500")}>
              {formatDate(new Date(card.deadline), locale)}
            </span>
          )}
          {card.subtasksTotal > 0 && (
            <span className="opacity-80">
              {card.subtasksDone}/{card.subtasksTotal}
            </span>
          )}
          {card.commentsCount > 0 && (
            <span className="opacity-70">{card.commentsCount}c</span>
          )}
          {card.blockedByCount > 0 && (
            <span className="text-red-500" title={t("cardBlockedBy", locale)}>
              !
            </span>
          )}
        </div>
        <div className="flex -space-x-1">
          {card.assignees.slice(0, 3).map((u) => (
            <Avatar
              key={u.id}
              src={u.avatarUrl}
              name={u.displayName ?? u.username}
              size={20}
            />
          ))}
        </div>
      </div>
    </Link>
  );
}

function ContextSubmenu({
  label,
  value,
  flip,
  children,
}: {
  label: string;
  value?: string | null;
  flip: boolean;
  children: ReactNode;
}) {
  return (
    <div className="group relative">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-default">
        <span>{label}</span>
        <span className="flex items-center gap-1 opacity-60">
          {value && <span className="text-xs">{value}</span>}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
      </div>
      <div
        className={cn(
          "absolute top-0 z-50 hidden group-hover:block",
          flip ? "right-full pr-1" : "left-full pl-1"
        )}
      >
        <div className="w-56 surface border rounded-lg shadow-xl py-1 max-h-72 overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

function CardContextMenu({
  card,
  members,
  boardTags,
  x,
  y,
  locale,
  onClose,
}: {
  card: CardDTO;
  members: MemberOption[];
  boardTags: TagOption[];
  x: number;
  y: number;
  locale: Locale;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const assignedIds = new Set(card.assignees.map((a) => a.id));
  const tagIds = new Set(card.tags.map((tg) => tg.id));
  const flip = typeof window !== "undefined" && x > window.innerWidth - 460;

  function run(action: (fd: FormData) => Promise<unknown>, fields: Record<string, string>) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("cardId", card.id);
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      await action(fd);
      router.refresh();
    });
  }

  const itemClass =
    "flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800";

  return (
    <div
      className="fixed z-50 w-52 surface border rounded-lg shadow-xl text-sm py-1"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      <ContextSubmenu label={t("cardAssignees", locale)} flip={flip}>
        {members.length === 0 && (
          <div className="px-3 py-1.5 opacity-60">{t("noResults", locale)}</div>
        )}
        {members.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => run(toggleAssigneeAction, { userId: u.id })}
            className={itemClass}
          >
            <Avatar src={u.avatarUrl} name={u.displayName ?? u.username} size={20} />
            <span className="flex-1 truncate">{u.displayName ?? u.username}</span>
            {assignedIds.has(u.id) && <span className="text-brand-600">&#10003;</span>}
          </button>
        ))}
      </ContextSubmenu>

      <ContextSubmenu label={t("cardTags", locale)} flip={flip}>
        {boardTags.length === 0 && (
          <div className="px-3 py-1.5 opacity-60">{t("noResults", locale)}</div>
        )}
        {boardTags.map((tg) => (
          <button
            key={tg.id}
            type="button"
            onClick={() => run(toggleCardTagAction, { tagId: tg.id })}
            className={itemClass}
          >
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: tg.color }} />
            <span className="flex-1 truncate">{tg.name}</span>
            {tagIds.has(tg.id) && <span className="text-brand-600">&#10003;</span>}
          </button>
        ))}
      </ContextSubmenu>

      <ContextSubmenu
        label={t("cardPriority", locale)}
        value={priorityLabel(card.priority, locale)}
        flip={flip}
      >
        {PRIORITIES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => run(updateCardAction, { priority: p })}
            className={cn(itemClass, card.priority === p && "font-semibold")}
          >
            <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", priorityClass(p))} />
            <span className="flex-1">{priorityLabel(p, locale)}</span>
            {card.priority === p && <span className="text-brand-600">&#10003;</span>}
          </button>
        ))}
      </ContextSubmenu>

      <ContextSubmenu label={t("cardCover", locale)} flip={flip}>
        <div className="flex flex-wrap gap-1.5 p-2">
          {COVER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => run(updateCardAction, { coverColor: c })}
              aria-label={c}
              className={cn(
                "w-6 h-6 rounded-full transition",
                card.coverColor?.toLowerCase() === c
                  ? "ring-2 ring-offset-1 ring-offset-[var(--bg)] ring-brand-500"
                  : "ring-1 ring-[var(--border)] hover:scale-110"
              )}
              style={{ background: c }}
            />
          ))}
          <button
            type="button"
            onClick={() => run(updateCardAction, { coverColor: "" })}
            aria-label={t("none", locale)}
            title={t("none", locale)}
            className={cn(
              "w-6 h-6 rounded-full border border-dashed border-[var(--border)] flex items-center justify-center text-xs leading-none",
              !card.coverColor ? "ring-2 ring-brand-500" : "opacity-70 hover:opacity-100"
            )}
          >
            &times;
          </button>
        </div>
      </ContextSubmenu>

      <div className="my-1 border-t border-[var(--border)]" />
      <form
        action={async (fd) => {
          await deleteCardAction(fd);
          onClose();
        }}
      >
        <input type="hidden" name="cardId" value={card.id} />
        <button
          type="submit"
          className="block w-full text-left px-3 py-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          {t("cardDelete", locale)}
        </button>
      </form>
    </div>
  );
}
