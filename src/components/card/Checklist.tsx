"use client";

import { useId, useOptimistic, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, CalendarDays, Check, GripVertical, SquareArrowOutUpRight, Trash2, UserPlus } from "lucide-react";
import Avatar from "@/components/Avatar";
import Combobox from "@/components/ui/Combobox";
import { DatePickerPopover } from "@/components/ui/DatePicker";
import { MenuButton, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { useUi } from "@/components/ui/UiProvider";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate, t, tn, type Locale } from "@/lib/i18n";
import { relativeDeadline } from "@/lib/deadline";
import type { ActionResult } from "@/lib/action-result";
import {
  addSubtaskAction,
  deleteSubtaskAction,
  renameSubtaskAction,
  toggleSubtaskAction,
} from "@/server/tasks-actions";
import {
  convertSubtaskToCardAction,
  moveSubtaskAction,
  setSubtaskAssigneeAction,
  setSubtaskDueAction,
} from "@/server/checklist-actions";
import { markLocalCards } from "@/components/board/live-changes";

// The card checklist (Checklists 2.0): items with their own assignee and due
// date, reordered by dragging the handle (pointer or Space plus arrow keys)
// or with Move up / Move down in the item menu, and convertible into cards.

export interface ChecklistMember {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
  /** "YYYY-MM-DD" or null. */
  dueDate: string | null;
  assignee: ChecklistMember | null;
}

type Change =
  | { type: "toggle"; id: string }
  | { type: "move"; id: string; to: number }
  | { type: "remove"; id: string }
  | { type: "patch"; id: string; patch: Partial<ChecklistItem> };

function reduce(items: ChecklistItem[], change: Change): ChecklistItem[] {
  switch (change.type) {
    case "toggle":
      return items.map((i) => (i.id === change.id ? { ...i, done: !i.done } : i));
    case "move": {
      const from = items.findIndex((i) => i.id === change.id);
      return from === -1 ? items : arrayMove(items, from, change.to);
    }
    case "remove":
      return items.filter((i) => i.id !== change.id);
    case "patch":
      return items.map((i) => (i.id === change.id ? { ...i, ...change.patch } : i));
  }
}

const NOBODY = "__nobody";

export default function Checklist({
  cardId,
  items: serverItems,
  members,
  locale,
}: {
  cardId: string;
  items: ChecklistItem[];
  members: ChecklistMember[];
  locale: Locale;
}) {
  const router = useRouter();
  const ui = useUi();
  const dndId = useId();
  const headingId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [, startTransition] = useTransition();
  const [items, apply] = useOptimistic(serverItems, reduce);
  const total = items.length;
  const done = items.filter((s) => s.done).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function run(change: Change | null, action: () => Promise<ActionResult<unknown>>) {
    startTransition(async () => {
      if (change) apply(change);
      ui.report(await action());
      router.refresh();
    });
  }

  function move(id: string, to: number) {
    run({ type: "move", id, to }, () => moveSubtaskAction({ subtaskId: id, position: to }));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const to = items.findIndex((i) => i.id === over.id);
    if (to !== -1) move(String(active.id), to);
  }

  const titleOf = (id: string | number) => items.find((i) => i.id === id)?.title ?? "";
  const positionText = (id: string | number, overId: string | number | undefined) => {
    const at = items.findIndex((i) => i.id === (overId ?? id));
    return t("subtaskMovedTo", locale)
      .replace("{title}", titleOf(id))
      .replace("{position}", String(at + 1))
      .replace("{total}", String(total));
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => positionText(active.id, undefined),
    onDragOver: ({ active, over }) => (over ? positionText(active.id, over.id) : undefined),
    onDragEnd: ({ active, over }) => (over ? positionText(active.id, over.id) : undefined),
    onDragCancel: ({ active }) => positionText(active.id, undefined),
  };

  function convert(item: ChecklistItem) {
    startTransition(async () => {
      apply({ type: "remove", id: item.id });
      const result = ui.report(await convertSubtaskToCardAction(item.id));
      if (result.ok) {
        const { boardId, cardId: newId } = result.data;
        markLocalCards([newId]);
        ui.toast({
          message: t("subtaskConverted", locale).replace("{title}", item.title),
          action: { label: t("subtaskOpenCard", locale), onAction: () => router.push(`/tasks/${boardId}/cards/${newId}`) },
        });
      }
      router.refresh();
    });
  }

  const rowProps = {
    locale,
    members,
    total,
    onToggle: (item: ChecklistItem) =>
      run({ type: "toggle", id: item.id }, () => {
        const fd = new FormData();
        fd.set("subtaskId", item.id);
        return toggleSubtaskAction(fd);
      }),
    onRename: (item: ChecklistItem, title: string) =>
      run({ type: "patch", id: item.id, patch: { title } }, () => {
        const fd = new FormData();
        fd.set("subtaskId", item.id);
        fd.set("title", title);
        return renameSubtaskAction(fd);
      }),
    onDelete: (item: ChecklistItem) =>
      run({ type: "remove", id: item.id }, () => {
        const fd = new FormData();
        fd.set("subtaskId", item.id);
        return deleteSubtaskAction(fd);
      }),
    onAssign: (item: ChecklistItem, userId: string | null) =>
      run(
        { type: "patch", id: item.id, patch: { assignee: members.find((m) => m.id === userId) ?? null } },
        () => setSubtaskAssigneeAction({ subtaskId: item.id, userId })
      ),
    onDue: (item: ChecklistItem, dueDate: string | null) =>
      run({ type: "patch", id: item.id, patch: { dueDate } }, () => setSubtaskDueAction({ subtaskId: item.id, dueDate })),
    onMove: move,
    onConvert: convert,
  };

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 id={headingId} className="text-md font-semibold">
          {t("cardSubtasks", locale)}
        </h2>
        {total > 0 && (
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <div
              role="progressbar"
              aria-label={t("cardSubtasks", locale)}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              aria-valuetext={tn("cardSubtasksA11y", total, locale).replace("{done}", String(done))}
              className="flex-1 h-1.5 rounded-full bg-ink/10 overflow-hidden"
            >
              <div
                className={cn("h-full transition-[width] duration-200", done === total ? "bg-success" : "bg-accent")}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-sm text-ink-muted tabular-nums shrink-0" aria-hidden>
              {done}/{total}
            </span>
          </div>
        )}
      </div>

      {total === 0 && <p className="text-sm text-ink-muted">{t("cardNoSubtasks", locale)}</p>}

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{ announcements, screenReaderInstructions: { draggable: t("subtaskDndInstructions", locale) } }}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-0.5" aria-label={t("cardSubtasks", locale)}>
            {items.map((item, index) => (
              <ChecklistRow key={item.id} item={item} index={index} {...rowProps} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          if (!String(fd.get("title") ?? "").trim()) return;
          formRef.current?.reset();
          run(null, () => addSubtaskAction(fd));
        }}
        className="flex gap-2"
      >
        <input type="hidden" name="cardId" value={cardId} />
        <input
          name="title"
          required
          maxLength={200}
          aria-label={t("cardSubtaskAdd", locale)}
          placeholder={t("cardSubtaskAdd", locale)}
          className="text-sm"
        />
        <button className={buttonClass("primary", "md")}>{t("add", locale)}</button>
      </form>
    </section>
  );
}

function ChecklistRow({
  item,
  index,
  total,
  locale,
  members,
  onToggle,
  onRename,
  onDelete,
  onAssign,
  onDue,
  onMove,
  onConvert,
}: {
  item: ChecklistItem;
  index: number;
  total: number;
  locale: Locale;
  members: ChecklistMember[];
  onToggle: (item: ChecklistItem) => void;
  onRename: (item: ChecklistItem, title: string) => void;
  onDelete: (item: ChecklistItem) => void;
  onAssign: (item: ChecklistItem, userId: string | null) => void;
  onDue: (item: ChecklistItem, dueDate: string | null) => void;
  onMove: (id: string, to: number) => void;
  onConvert: (item: ChecklistItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const dueRef = useRef<HTMLButtonElement>(null);
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  // Empty date and assignee buttons fade in on hover or focus (devices with
  // hover only; on touch they stay visible).
  const quiet =
    "[@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100";
  const due = item.dueDate ? relativeDeadline(item.dueDate, locale) : null;
  const dueTitle = t("subtaskDue", locale).replace("{title}", item.title);
  const assigneeName = item.assignee ? item.assignee.displayName ?? item.assignee.username : null;
  const control =
    "inline-flex items-center justify-center rounded-control text-ink-muted hover:text-ink hover:bg-ink/5 outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-subtask-id={item.id}
      className={cn(
        "group flex items-center gap-1 rounded-control pr-1 hover:bg-ink/[0.03]",
        isDragging && "relative z-10 bg-raised shadow-float"
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t("subtaskReorder", locale).replace("{title}", item.title)}
        className={cn(control, "w-6 h-7 cursor-grab touch-none shrink-0")}
      >
        <GripVertical size={14} aria-hidden />
      </button>
      <label className="relative w-7 h-7 shrink-0 flex items-center justify-center cursor-pointer">
        <input
          type="checkbox"
          checked={item.done}
          onChange={() => onToggle(item)}
          aria-label={t("subtaskToggle", locale).replace("{title}", item.title)}
          className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer m-0"
        />
        <span
          aria-hidden
          className={cn(
            "w-4 h-4 rounded border flex items-center justify-center peer-focus-visible:ring-2 peer-focus-visible:ring-accent",
            item.done ? "bg-accent border-accent text-accent-fg" : "border-line-strong"
          )}
        >
          {item.done && <Check size={12} strokeWidth={3} />}
        </span>
      </label>

      <div className="flex-1 min-w-0">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const title = String(new FormData(e.currentTarget).get("title") ?? "").trim();
              setEditing(false);
              if (title && title !== item.title) onRename(item, title);
            }}
            className="flex gap-1 py-0.5"
          >
            <input
              name="title"
              defaultValue={item.title}
              autoFocus
              required
              maxLength={200}
              aria-label={t("rename", locale)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
              className="!py-0.5 !px-2 text-sm"
            />
            <button className={buttonClass("primary", "sm")}>{t("save", locale)}</button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            data-subtask-title
            className={cn(
              "w-full min-h-7 text-left text-sm break-words rounded-control px-1 outline-none focus-visible:ring-2 focus-visible:ring-accent",
              item.done && "line-through text-ink-muted"
            )}
          >
            {item.title}
          </button>
        )}
      </div>

      <button
        ref={dueRef}
        type="button"
        onClick={() => setDueOpen(true)}
        aria-label={due ? `${dueTitle}: ${formatDate(new Date(item.dueDate!), locale)}` : dueTitle}
        title={due ? formatDate(new Date(item.dueDate!), locale) : dueTitle}
        className={cn(
          control,
          "h-7 shrink-0 gap-1 text-xs tabular-nums",
          due ? "px-1.5 border border-line" : cn("w-7", quiet),
          due && !item.done && due.tone === "late" && "text-danger border-danger/40",
          due && !item.done && due.tone === "soon" && "text-warning border-warning/40"
        )}
      >
        <CalendarDays size={14} aria-hidden />
        {due && <span aria-hidden>{due.label}</span>}
      </button>
      <DatePickerPopover
        triggerRef={dueRef}
        isOpen={dueOpen}
        onOpenChange={setDueOpen}
        title={dueTitle}
        value={item.dueDate}
        onChange={(value) => onDue(item, value)}
        locale={locale}
      />

      <Combobox
        label={
          assigneeName
            ? `${t("subtaskAssign", locale).replace("{title}", item.title)}: ${assigneeName}`
            : t("subtaskAssign", locale).replace("{title}", item.title)
        }
        searchLabel={t("pickerSearchMembers", locale)}
        emptyText={t("pickerNoMatches", locale)}
        onSelect={(id) => onAssign(item, id === NOBODY ? null : id)}
        options={[
          ...(item.assignee ? [{ id: NOBODY, label: t("subtaskUnassigned", locale) }] : []),
          ...members.map((u) => ({
            id: u.id,
            label: u.displayName ?? u.username,
            description: `@${u.username}`,
            leading: <Avatar src={u.avatarUrl} name={u.displayName ?? u.username} size={22} />,
          })),
        ]}
        trigger={
          item.assignee ? (
            <Avatar src={item.assignee.avatarUrl} name={assigneeName} size={22} />
          ) : (
            <UserPlus size={14} aria-hidden />
          )
        }
        triggerClassName={cn(control, "w-7 h-7 shrink-0 rounded-full", !item.assignee && quiet)}
      />

      <MenuButton label={t("subtaskActions", locale).replace("{title}", item.title)} className="shrink-0">
        <MenuItem onAction={() => setEditing(true)}>{t("rename", locale)}</MenuItem>
        <MenuItem isDisabled={index === 0} onAction={() => onMove(item.id, index - 1)}>
          <ArrowUp size={14} aria-hidden />
          {t("subtaskMoveUp", locale)}
        </MenuItem>
        <MenuItem isDisabled={index === total - 1} onAction={() => onMove(item.id, index + 1)}>
          <ArrowDown size={14} aria-hidden />
          {t("subtaskMoveDown", locale)}
        </MenuItem>
        <MenuItem onAction={() => onConvert(item)}>
          <SquareArrowOutUpRight size={14} aria-hidden />
          {t("subtaskConvert", locale)}
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger onAction={() => onDelete(item)}>
          <Trash2 size={14} aria-hidden />
          {t("delete", locale)}
        </MenuItem>
      </MenuButton>
    </li>
  );
}
