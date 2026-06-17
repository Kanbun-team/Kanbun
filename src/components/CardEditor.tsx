"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Avatar from "./Avatar";
import { cn } from "@/lib/utils";
import { PRIORITIES, priorityClass, priorityLabel } from "@/lib/labels";
import { t, type Locale } from "@/lib/i18n";
import { renderMarkdownToHtml } from "@/lib/markdown";
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
      className="prose-sm text-sm cursor-pointer surface border border-dashed border-[var(--border)] rounded-md p-3 min-h-[60px] [&_a]:break-words [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold space-y-2"
      onClick={() => setEditing(true)}
    >
      {value ? (
        <div dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(value) }} />
      ) : (
        <span className="opacity-60">{t("cardDescription", locale)}...</span>
      )}
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(initialPriority);
  useEffect(() => setValue(initialPriority), [initialPriority]);

  function pick(p: string) {
    if (p === value) return;
    setValue(p); // optimistic
    startTransition(async () => {
      const fd = new FormData();
      fd.set("cardId", cardId);
      fd.set("priority", p);
      await updateCardAction(fd);
      router.refresh();
    });
  }

  return (
    <div className={cn("flex flex-wrap gap-1.5", pending && "opacity-60")}>
      {PRIORITIES.map((p) => {
        const active = value === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => pick(p)}
            aria-pressed={active}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium border transition",
              active
                ? cn(priorityClass(p), "border-transparent shadow-sm")
                : "border-[var(--border)] opacity-55 hover:opacity-100 hover:border-brand-500"
            )}
          >
            {priorityLabel(p, locale)}
          </button>
        );
      })}
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(initialDeadline ? initialDeadline.slice(0, 10) : "");
  useEffect(() => setValue(initialDeadline ? initialDeadline.slice(0, 10) : ""), [initialDeadline]);

  function save(next: string) {
    setValue(next); // optimistic
    startTransition(async () => {
      const fd = new FormData();
      fd.set("cardId", cardId);
      fd.set("deadline", next);
      await updateCardAction(fd);
      router.refresh();
    });
  }

  const overdue = value !== "" && new Date(value).getTime() < Date.now();

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", pending && "opacity-60")}>
      <input
        type="date"
        value={value}
        onChange={(e) => save(e.target.value)}
        className={cn("!py-1 !text-sm w-auto", overdue && "text-red-500 border-red-400")}
      />
      {value === "" ? (
        <span className="text-xs opacity-50">{t("cardNoDeadline", locale)}</span>
      ) : (
        <>
          {overdue && (
            <span className="text-xs font-medium text-red-500">{t("cardOverdue", locale)}</span>
          )}
          <button
            type="button"
            onClick={() => save("")}
            aria-label={t("remove", locale)}
            title={t("remove", locale)}
            className="text-sm opacity-50 hover:opacity-100 hover:text-red-500"
          >
            &times;
          </button>
        </>
      )}
    </div>
  );
}

const COVER_PRESETS = [
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

export function CardCover({
  cardId,
  initialColor,
  locale,
}: {
  cardId: string;
  initialColor: string | null;
  locale: Locale;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(initialColor);
  useEffect(() => setValue(initialColor), [initialColor]);

  function pick(color: string | null) {
    setValue(color); // optimistic
    startTransition(async () => {
      const fd = new FormData();
      fd.set("cardId", cardId);
      fd.set("coverColor", color ?? "");
      await updateCardAction(fd);
      router.refresh();
    });
  }

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", pending && "opacity-60")}>
      {COVER_PRESETS.map((c) => {
        const active = value?.toLowerCase() === c;
        return (
          <button
            key={c}
            type="button"
            onClick={() => pick(c)}
            aria-label={c}
            aria-pressed={active}
            className={cn(
              "w-6 h-6 rounded-full transition",
              active
                ? "ring-2 ring-offset-1 ring-offset-[var(--bg)] ring-brand-500"
                : "ring-1 ring-[var(--border)] hover:scale-110"
            )}
            style={{ background: c }}
          />
        );
      })}
      <button
        type="button"
        onClick={() => pick(null)}
        aria-label={t("none", locale)}
        title={t("none", locale)}
        className={cn(
          "w-6 h-6 rounded-full border border-dashed border-[var(--border)] flex items-center justify-center text-xs leading-none",
          !value ? "ring-2 ring-brand-500" : "opacity-70 hover:opacity-100"
        )}
      >
        &times;
      </button>
    </div>
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
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const assignedIds = new Set(assignees.map((a) => a.id));

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  function toggle(userId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("cardId", cardId);
      fd.set("userId", userId);
      await toggleAssigneeAction(fd);
      router.refresh();
    });
  }

  return (
    <div className="relative" ref={wrapRef}>
      <div className={cn("flex items-center gap-1.5 flex-wrap", pending && "opacity-60")}>
        {assignees.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => toggle(u.id)}
            title={`${u.displayName ?? u.username} — ${t("remove", locale)}`}
            className="group relative rounded-full focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <Avatar src={u.avatarUrl} name={u.displayName ?? u.username} size={28} />
            <span className="absolute inset-0 rounded-full bg-black/55 text-white text-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
              &times;
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={t("add", locale)}
          aria-expanded={open}
          className="w-7 h-7 rounded-full border border-dashed border-[var(--border)] flex items-center justify-center text-base leading-none opacity-70 hover:opacity-100 hover:border-brand-500"
        >
          +
        </button>
        {assignees.length === 0 && (
          <span className="text-sm opacity-50">{t("cardNoAssignees", locale)}</span>
        )}
      </div>
      {open && (
        <div className="absolute mt-2 z-50 w-64 surface border rounded-lg shadow-lg max-h-72 overflow-auto p-1">
          {members.length === 0 && (
            <div className="px-3 py-2 text-sm opacity-60">{t("noResults", locale)}</div>
          )}
          {members.map((u) => {
            const on = assignedIds.has(u.id);
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => toggle(u.id)}
                className={cn(
                  "flex items-center gap-2 w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800",
                  on && "bg-slate-50 dark:bg-slate-800/50"
                )}
              >
                <Avatar src={u.avatarUrl} name={u.displayName ?? u.username} size={22} />
                <span className="text-sm flex-1 truncate">{u.displayName ?? u.username}</span>
                {on && <span className="text-brand-600">&#10003;</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
