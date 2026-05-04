"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Avatar from "./Avatar";
import { cn } from "@/lib/utils";
import { priorityClass, priorityLabel, type Priority } from "@/lib/labels";
import { t, type Locale, formatDate } from "@/lib/i18n";
import {
  addCardAction,
  addColumnAction,
  deleteCardAction,
  deleteColumnAction,
  moveCardAction,
  renameColumnAction,
  updateCardAction,
} from "@/server/tasks-actions";

export interface CardDTO {
  id: string;
  title: string;
  priority: string;
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
  cards: CardDTO[];
}

export interface TaskBoardProps {
  boardId: string;
  columns: ColumnDTO[];
  locale: Locale;
  canManage: boolean;
}

export default function TaskBoard({ boardId, columns: initialColumns, locale, canManage }: TaskBoardProps) {
  const [columns, setColumns] = useState(initialColumns);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ columnId: string; index: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; cardId: string } | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => setColumns(initialColumns), [initialColumns]);

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
    <div className="flex gap-4 overflow-x-auto pb-2 scroll-shadow snap-x">
      {columns.map((col) => (
        <div
          key={col.id}
          className="surface border rounded-xl w-80 shrink-0 snap-start flex flex-col max-h-[80vh]"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver({ columnId: col.id, index: col.cards.length });
          }}
          onDrop={(e) => {
            e.preventDefault();
            const idx = dragOver?.columnId === col.id ? dragOver.index : col.cards.length;
            handleDrop(col.id, idx);
          }}
        >
          <ColumnHeader
            column={col}
            locale={locale}
            canManage={canManage}
            boardId={boardId}
          />
          <div className="px-2 py-1 flex-1 overflow-y-auto space-y-2">
            {col.cards.map((card, i) => (
              <div
                key={card.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver({ columnId: col.id, index: i });
                }}
              >
                {dragOver?.columnId === col.id && dragOver.index === i && (
                  <div className="h-1.5 rounded bg-brand-500/60 my-1" />
                )}
                <CardItem
                  boardId={boardId}
                  card={card}
                  locale={locale}
                  onDragStart={() => handleDragStart(card.id)}
                  onDragEnd={handleDragEnd}
                  onContextMenu={(x, y) => setContextMenu({ x, y, cardId: card.id })}
                />
              </div>
            ))}
            {dragOver?.columnId === col.id && dragOver.index >= col.cards.length && (
              <div className="h-1.5 rounded bg-brand-500/60 my-1" />
            )}
          </div>
          <AddCardForm columnId={col.id} locale={locale} />
        </div>
      ))}
      {canManage && <AddColumnForm boardId={boardId} locale={locale} />}
      {contextMenu && (
        <CardContextMenu
          locale={locale}
          card={allCards.find((c) => c.id === contextMenu.cardId)!}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

function ColumnHeader({
  column,
  locale,
  canManage,
  boardId,
}: {
  column: ColumnDTO;
  locale: Locale;
  canManage: boolean;
  boardId: string;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-2">
      {editing ? (
        <form
          action={async (fd) => {
            await renameColumnAction(fd);
            setEditing(false);
          }}
          className="flex-1 flex gap-2"
        >
          <input type="hidden" name="columnId" value={column.id} />
          <input
            name="name"
            defaultValue={column.name}
            autoFocus
            maxLength={80}
            className="!py-1"
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
          <span className="text-xs opacity-60">{column.cards.length}</span>
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
  if (!open) {
    return (
      <button
        type="button"
        className="m-2 text-sm text-left px-3 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 opacity-80"
        onClick={() => setOpen(true)}
      >
        + {t("cardAdd", locale)}
      </button>
    );
  }
  return (
    <form
      ref={ref}
      action={async (fd) => {
        await addCardAction(fd);
        ref.current?.reset();
      }}
      className="m-2 space-y-2"
    >
      <input type="hidden" name="columnId" value={columnId} />
      <textarea
        name="title"
        required
        maxLength={200}
        rows={2}
        autoFocus
        placeholder={t("cardTitle", locale)}
        className="w-full"
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
  onDragStart,
  onDragEnd,
  onContextMenu,
}: {
  boardId: string;
  card: CardDTO;
  locale: Locale;
  onDragStart: () => void;
  onDragEnd: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const overdue = card.deadline && new Date(card.deadline).getTime() < Date.now();
  return (
    <Link
      href={`/tasks/${boardId}/cards/${card.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      className="block surface border rounded-lg p-3 hover:border-brand-500 transition shadow-sm"
    >
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

function CardContextMenu({
  card,
  x,
  y,
  locale,
  onClose,
}: {
  card: CardDTO;
  x: number;
  y: number;
  locale: Locale;
  onClose: () => void;
}) {
  const priorities: Priority[] = ["low", "normal", "high", "critical"];
  return (
    <div
      className="fixed z-50 w-56 surface border rounded-lg shadow-xl text-sm"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2 text-xs uppercase tracking-wide opacity-60 border-b border-[var(--border)]">
        {t("cardPriority", locale)}
      </div>
      {priorities.map((p) => (
        <form
          key={p}
          action={async (fd) => {
            await updateCardAction(fd);
            onClose();
          }}
        >
          <input type="hidden" name="cardId" value={card.id} />
          <input type="hidden" name="priority" value={p} />
          <button
            type="submit"
            className={cn(
              "block w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800",
              card.priority === p && "font-semibold"
            )}
          >
            {priorityLabel(p, locale)}
          </button>
        </form>
      ))}
      <form
        action={async (fd) => {
          await deleteCardAction(fd);
          onClose();
        }}
        className="border-t border-[var(--border)]"
      >
        <input type="hidden" name="cardId" value={card.id} />
        <button
          type="submit"
          className="block w-full text-left px-3 py-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          {t("cardDelete", locale)}
        </button>
      </form>
    </div>
  );
}
