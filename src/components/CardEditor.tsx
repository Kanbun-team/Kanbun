"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Avatar from "./Avatar";
import { cn } from "@/lib/utils";
import { priorityClass, priorityLabel, type Priority } from "@/lib/labels";
import { t, type Locale, formatDate } from "@/lib/i18n";
import { toggleAssigneeAction, updateCardAction } from "@/server/tasks-actions";

interface CardEditorProps {
  cardId: string;
  initialTitle: string;
  initialDescription: string;
  initialPriority: string;
  initialDeadline: string | null;
  assignees: { id: string; displayName: string | null; username: string; avatarUrl: string | null }[];
  members: { id: string; displayName: string | null; username: string; avatarUrl: string | null }[];
  locale: Locale;
}

export function CardTitleEditor({
  cardId,
  initialTitle,
  locale,
}: {
  cardId: string;
  initialTitle: string;
  locale: Locale;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialTitle);
  const router = useRouter();
  if (editing) {
    return (
      <form
        action={async (fd) => {
          await updateCardAction(fd);
          setEditing(false);
          router.refresh();
        }}
        className="flex gap-2"
      >
        <input type="hidden" name="cardId" value={cardId} />
        <input
          name="title"
          defaultValue={value}
          autoFocus
          required
          maxLength={200}
          onChange={(e) => setValue(e.target.value)}
          className="text-xl font-semibold"
        />
        <button className="rounded bg-brand-600 hover:bg-brand-700 text-white text-sm px-3">
          {t("save", locale)}
        </button>
      </form>
    );
  }
  return (
    <h1
      className="text-xl font-semibold cursor-pointer"
      onClick={() => setEditing(true)}
      title={t("edit", locale)}
    >
      {value}
    </h1>
  );
}

export function CardDescriptionEditor({
  cardId,
  initialDescription,
  locale,
}: {
  cardId: string;
  initialDescription: string;
  locale: Locale;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialDescription);
  const router = useRouter();
  if (editing) {
    return (
      <form
        action={async (fd) => {
          await updateCardAction(fd);
          setEditing(false);
          router.refresh();
        }}
        className="space-y-2"
      >
        <input type="hidden" name="cardId" value={cardId} />
        <textarea
          name="description"
          rows={6}
          defaultValue={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={20_000}
          className="w-full"
          autoFocus
        />
        <div className="flex gap-2">
          <button className="rounded bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-1">
            {t("save", locale)}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-sm px-3 py-1 opacity-70 hover:opacity-100"
          >
            {t("cancel", locale)}
          </button>
        </div>
      </form>
    );
  }
  return (
    <div
      className="prose dark:prose-invert text-sm whitespace-pre-wrap cursor-pointer surface border border-dashed border-[var(--border)] rounded-md p-3 min-h-[60px]"
      onClick={() => setEditing(true)}
    >
      {value || <span className="opacity-60">{t("cardDescription", locale)}...</span>}
    </div>
  );
}

export function CardPriorityEditor({
  cardId,
  initialPriority,
  locale,
}: {
  cardId: string;
  initialPriority: string;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const priorities: Priority[] = ["low", "normal", "high", "critical"];
  const [, startTransition] = useTransition();
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn("rounded px-2 py-1 text-sm", priorityClass(initialPriority))}
      >
        {priorityLabel(initialPriority, locale)}
      </button>
      {open && (
        <div className="absolute mt-2 z-50 w-40 surface border rounded-lg shadow-lg">
          {priorities.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() =>
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("cardId", cardId);
                  fd.set("priority", p);
                  await updateCardAction(fd);
                  setOpen(false);
                  router.refresh();
                })
              }
              className={cn(
                "block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800",
                initialPriority === p && "font-semibold"
              )}
            >
              {priorityLabel(p, locale)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CardDeadlineEditor({
  cardId,
  initialDeadline,
  locale,
}: {
  cardId: string;
  initialDeadline: string | null;
  locale: Locale;
}) {
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  if (editing) {
    return (
      <form
        action={async (fd) => {
          await updateCardAction(fd);
          setEditing(false);
          router.refresh();
        }}
        className="flex gap-2 items-center"
      >
        <input type="hidden" name="cardId" value={cardId} />
        <input
          type="date"
          name="deadline"
          defaultValue={initialDeadline ? initialDeadline.slice(0, 10) : ""}
          className="!py-1"
          autoFocus
        />
        <button className="rounded bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-1">
          {t("save", locale)}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-sm opacity-70"
        >
          {t("cancel", locale)}
        </button>
      </form>
    );
  }
  return (
    <button type="button" className="text-sm underline-offset-2 hover:underline" onClick={() => setEditing(true)}>
      {initialDeadline ? formatDate(new Date(initialDeadline), locale) : t("cardNoDeadline", locale)}
    </button>
  );
}

export function CardAssignees({
  cardId,
  assignees,
  members,
  locale,
}: Pick<CardEditorProps, "cardId" | "assignees" | "members" | "locale">) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const assignedIds = new Set(assignees.map((a) => a.id));
  return (
    <div className="relative">
      <div className="flex items-center gap-2 flex-wrap">
        {assignees.length === 0 && (
          <span className="text-sm opacity-60">{t("cardNoAssignees", locale)}</span>
        )}
        {assignees.map((u) => (
          <div key={u.id} className="flex items-center gap-1 text-xs">
            <Avatar src={u.avatarUrl} name={u.displayName ?? u.username} size={20} />
            <span>{u.displayName ?? u.username}</span>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-md text-xs px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 border border-[var(--border)]"
        >
          {t("edit", locale)}
        </button>
      </div>
      {open && (
        <div className="absolute mt-2 z-50 w-64 surface border rounded-lg shadow-lg max-h-72 overflow-auto">
          {members.length === 0 && (
            <div className="px-3 py-2 text-sm opacity-60">{t("noResults", locale)}</div>
          )}
          {members.map((u) => (
            <form
              key={u.id}
              action={async (fd) => {
                await toggleAssigneeAction(fd);
                router.refresh();
              }}
            >
              <input type="hidden" name="cardId" value={cardId} />
              <input type="hidden" name="userId" value={u.id} />
              <button
                type="submit"
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Avatar src={u.avatarUrl} name={u.displayName ?? u.username} size={20} />
                <span className="text-sm flex-1 truncate">{u.displayName ?? u.username}</span>
                {assignedIds.has(u.id) && <span className="text-brand-600">&#10003;</span>}
              </button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
