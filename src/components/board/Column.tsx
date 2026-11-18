"use client";

import { useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, ChevronsLeftRight } from "lucide-react";
import { MenuButton, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n";
import CardFace from "./CardFace";
import { CardFaceViewers } from "@/components/presence/Presence";
import CardMenu, { type CardMenuHandlers } from "./CardMenu";
import { columnKey, type CardDTO, type ColumnDTO, type MemberOption, type TagOption } from "./types";

export interface ColumnHandlers {
  rename: (column: ColumnDTO, name: string, wipLimit: number | null) => Promise<boolean>;
  move: (column: ColumnDTO, delta: -1 | 1) => void;
  toggleCollapsed: (column: ColumnDTO) => void;
  remove: (column: ColumnDTO) => void;
  addCards: (column: ColumnDTO, text: string) => Promise<boolean>;
  setAdding: (columnId: string | null) => void;
  renameCard: (card: CardDTO, title: string) => void;
  setEditing: (cardId: string | null) => void;
}

interface Shared {
  boardId: string;
  locale: Locale;
  canManage: boolean;
  dndDisabled: boolean;
  members: MemberOption[];
  boardTags: TagOption[];
  currentUserId: string;
  cardHandlers: CardMenuHandlers;
  columnHandlers: ColumnHandlers;
  editingCardId: string | null;
}

export default function Column({
  column,
  visibleCards,
  index,
  total,
  collapsed,
  adding,
  shared,
}: {
  column: ColumnDTO;
  visibleCards: CardDTO[];
  index: number;
  total: number;
  collapsed: boolean;
  adding: boolean;
  shared: Shared;
}) {
  const { locale, canManage, dndDisabled, columnHandlers: h } = shared;
  const { setNodeRef, setActivatorNodeRef, attributes: handleAttributes, listeners: handleListeners, transform, transition, isDragging } = useSortable({
    id: columnKey(column.id),
    data: { type: "column" },
    disabled: { draggable: !canManage || dndDisabled, droppable: false },
  });
  const [editing, setEditing] = useState(false);
  const count = column.cards.length;
  const wip = column.wipLimit;
  const wipState = wip == null ? null : count > wip ? "over" : count === wip ? "reached" : "ok";

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition,
  };

  if (collapsed) {
    return (
      <section
        ref={setNodeRef}
        style={style}
        aria-label={column.name}
        data-column-id={column.id}
        className={cn("shrink-0 w-11 bg-surface border border-line rounded-panel snap-start", isDragging && "opacity-40")}
      >
        <button
          type="button"
          onClick={() => h.toggleCollapsed(column)}
          aria-label={t("columnExpand", locale).replace("{name}", column.name)}
          className="w-full h-full min-h-48 flex flex-col items-center gap-2 py-3 hover:bg-ink/5 rounded-panel"
        >
          <ChevronsLeftRight size={16} aria-hidden className="text-ink-muted" />
          <span className="text-sm tabular-nums text-ink-muted">{count}</span>
          <span className="font-semibold [writing-mode:vertical-rl] rotate-180 truncate max-h-60">{column.name}</span>
        </button>
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      style={style}
      aria-label={column.name}
      data-column-id={column.id}
      className={cn(
        "shrink-0 w-[85vw] sm:w-72 snap-start flex flex-col max-h-[calc(100dvh-14rem)] sm:max-h-[calc(100dvh-12rem)] bg-surface border border-line rounded-panel",
        isDragging && "opacity-40"
      )}
    >
      <header className="pl-1.5 pr-1.5 py-1.5 flex items-center gap-1 border-b border-line">
        {canManage && !dndDisabled ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...handleAttributes}
            {...handleListeners}
            aria-label={t("dragColumn", locale).replace("{name}", column.name)}
            className="w-6 h-7 inline-flex items-center justify-center rounded-control text-ink-muted hover:text-ink hover:bg-ink/5 cursor-grab active:cursor-grabbing touch-none"
          >
            <GripVertical size={14} aria-hidden />
          </button>
        ) : (
          <span className="w-1.5" />
        )}
        {editing ? (
          <ColumnEditForm column={column} locale={locale} onDone={() => setEditing(false)} onSave={h.rename} />
        ) : (
          <>
            <h2 className="flex-1 min-w-0">
              <button
                type="button"
                className="w-full text-left font-semibold truncate rounded-control px-1 py-0.5 hover:bg-ink/5"
                onClick={() => setEditing(true)}
                title={t("columnRename", locale)}
              >
                {column.name}
              </button>
            </h2>
            <span
              className={cn(
                "text-sm tabular-nums px-1.5 rounded-control",
                wipState === "over" ? "bg-danger/10 text-danger font-semibold" : wipState === "reached" ? "bg-warning/10 text-warning font-semibold" : "text-ink-muted"
              )}
              title={wipState === "over" ? t("columnWipOver", locale) : wipState === "reached" ? t("columnWipReached", locale) : undefined}
            >
              {count}
              {wip != null && `/${wip}`}
              {wipState === "over" && <span className="sr-only">, {t("columnWipOver", locale)}</span>}
              {wipState === "reached" && <span className="sr-only">, {t("columnWipReached", locale)}</span>}
            </span>
            <MenuButton label={t("columnActions", locale).replace("{name}", column.name)}>
              <MenuItem onAction={() => setEditing(true)}>{t("columnRename", locale)}</MenuItem>
              <MenuItem onAction={() => setEditing(true)}>{t("columnEditWip", locale)}</MenuItem>
              <MenuItem onAction={() => h.setAdding(column.id)}>{t("cardAdd", locale)}</MenuItem>
              {canManage && index > 0 && <MenuItem onAction={() => h.move(column, -1)}>{t("columnMoveLeft", locale)}</MenuItem>}
              {canManage && index < total - 1 && (
                <MenuItem onAction={() => h.move(column, 1)}>{t("columnMoveRight", locale)}</MenuItem>
              )}
              <MenuItem onAction={() => h.toggleCollapsed(column)}>{t("columnCollapse", locale)}</MenuItem>
              {canManage && (
                <>
                  <MenuSeparator />
                  <MenuItem danger onAction={() => h.remove(column)}>
                    {t("columnDelete", locale)}
                  </MenuItem>
                </>
              )}
            </MenuButton>
          </>
        )}
      </header>

      <div className="px-2 py-2 flex-1 overflow-y-auto space-y-2 min-h-12">
        <SortableContext items={visibleCards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {visibleCards.map((card) => (
            <SortableCard key={card.id} card={card} columnId={column.id} shared={shared} />
          ))}
        </SortableContext>
        {!shared.dndDisabled &&
          (adding ? (
            <AddCardForm column={column} locale={locale} onAdd={h.addCards} onClose={() => h.setAdding(null)} />
          ) : (
            <button
              type="button"
              className="w-full flex items-center gap-2 rounded-card px-2 py-1.5 text-ink-muted hover:text-ink hover:bg-ink/5"
              onClick={() => h.setAdding(column.id)}
            >
              <Plus size={16} aria-hidden />
              {t("cardAdd", locale)}
            </button>
          ))}
      </div>
    </section>
  );
}

function SortableCard({ card, columnId, shared }: { card: CardDTO; columnId: string; shared: Shared }) {
  const { boardId, locale, dndDisabled, editingCardId } = shared;
  const [menuOpen, setMenuOpen] = useState(false);
  const { setNodeRef, attributes: rawAttributes, listeners, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card", columnId },
    disabled: dndDisabled,
  });
  // Keep the link semantics (Enter opens the card); Space picks it up.
  const { role: _role, ...attributes } = rawAttributes;
  void _role;
  const editing = editingCardId === card.id;

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: transition,
  };
  const faceClass =
    "relative block overflow-hidden rounded-card bg-raised border border-line shadow-card px-3 pt-2.5 pb-2.5 outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-card-id={card.id}
      className={cn("group relative", isDragging && "opacity-40")}
    >
      {editing ? (
        <div className={faceClass}>
          <InlineTitleEditor
            card={card}
            locale={locale}
            onSave={(title) => shared.columnHandlers.renameCard(card, title)}
            onClose={() => shared.columnHandlers.setEditing(null)}
          />
        </div>
      ) : (
        <Link
          href={`/tasks/${boardId}/cards/${card.id}`}
          scroll={false}
          {...attributes}
          {...listeners}
          aria-roledescription={undefined}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuOpen(true);
          }}
          className={cn(faceClass, card.coverColor && "pt-3.5", !dndDisabled && "touch-manipulation")}
        >
          <CardFace card={card} locale={locale} />
        </Link>
      )}
      <CardFaceViewers boardId={boardId} cardId={card.id} currentUserId={shared.currentUserId} locale={locale} />
      {!editing && (
        <div
          className={cn(
            "absolute right-1 top-1.5 transition-opacity",
            menuOpen ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          )}
        >
          <CardMenu
            card={card}
            members={shared.members}
            boardTags={shared.boardTags}
            currentUserId={shared.currentUserId}
            locale={locale}
            handlers={shared.cardHandlers}
            isOpen={menuOpen}
            onOpenChange={setMenuOpen}
          />
        </div>
      )}
    </div>
  );
}

function InlineTitleEditor({
  card,
  locale,
  onSave,
  onClose,
}: {
  card: CardDTO;
  locale: Locale;
  onSave: (title: string) => void;
  onClose: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const title = String(new FormData(e.currentTarget).get("title") ?? "").trim();
        if (title && title !== card.title) onSave(title);
        onClose();
      }}
    >
      <textarea
        name="title"
        defaultValue={card.title}
        maxLength={200}
        rows={2}
        autoFocus
        aria-label={t("cardTitle", locale)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => e.currentTarget.form?.requestSubmit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        className="w-full !p-1 !text-base font-medium"
      />
    </form>
  );
}

function AddCardForm({
  column,
  locale,
  onAdd,
  onClose,
}: {
  column: ColumnDTO;
  locale: Locale;
  onAdd: ColumnHandlers["addCards"];
  onClose: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    const text = ref.current?.value ?? "";
    if (!text.trim() || busy) return;
    setBusy(true);
    const ok = await onAdd(column, text);
    setBusy(false);
    if (ok && ref.current) {
      ref.current.value = "";
      ref.current.focus();
    }
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        name="title"
        rows={2}
        autoFocus
        aria-label={t("cardTitle", locale)}
        placeholder={t("cardTitle", locale)}
        aria-describedby={`add-hint-${column.id}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <p id={`add-hint-${column.id}`} className="text-xs text-ink-muted">
        {t("cardAddHint", locale)}
      </p>
      <div className="flex gap-2">
        <button className={buttonClass("primary", "sm")} disabled={busy}>
          {t("add", locale)}
        </button>
        <button type="button" onClick={onClose} className={buttonClass("ghost", "sm")}>
          {t("cancel", locale)}
        </button>
      </div>
    </form>
  );
}

function ColumnEditForm({
  column,
  locale,
  onSave,
  onDone,
}: {
  column: ColumnDTO;
  locale: Locale;
  onSave: ColumnHandlers["rename"];
  onDone: () => void;
}) {
  return (
    <form
      className="flex-1 flex flex-wrap gap-1.5 py-0.5"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const name = String(fd.get("name") ?? "").trim();
        const raw = String(fd.get("wipLimit") ?? "").trim();
        if (!name) return;
        if (await onSave(column, name, raw ? Number(raw) : null)) onDone();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
      }}
    >
      <input name="name" defaultValue={column.name} autoFocus maxLength={80} aria-label={t("columnName", locale)} className="!py-1 flex-1 min-w-0" />
      <input
        type="number"
        name="wipLimit"
        min={1}
        max={999}
        defaultValue={column.wipLimit ?? ""}
        placeholder="WIP"
        aria-label={t("columnWipLimit", locale)}
        className="!py-1 w-16"
      />
      <button className={buttonClass("primary", "sm")}>{t("save", locale)}</button>
    </form>
  );
}
