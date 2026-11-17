"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, iconButtonClass } from "./ui/button";
import Avatar from "./Avatar";
import { cn, isPast } from "@/lib/utils";
import { useSyncedState } from "@/lib/use-synced-state";
import { PALETTE } from "@/lib/palette";
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
        <button className="rounded-control bg-accent hover:bg-accent-hover text-accent-fg text-sm font-medium px-3">
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
          <button className={buttonClass("primary")}>
            {t("save", locale)}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className={buttonClass("ghost")}
          >
            {t("cancel", locale)}
          </button>
        </div>
      </form>
    );
  }
  return (
    <div
      className="prose-sm text-md cursor-pointer bg-surface border border-dashed border-line-strong rounded-card p-3 max-w-[70ch] [&_a]:text-accent [&_a]:underline min-h-[60px] [&_a]:break-words [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold space-y-2"
      onClick={() => setEditing(true)}
    >
      {value ? (
        <div dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(value) }} />
      ) : (
        <span className="text-ink-muted">{t("cardDescription", locale)}...</span>
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
  const [value, setValue] = useSyncedState(initialPriority);

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
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition",
              active
                ? "border-accent bg-accent-soft text-ink"
                : "border-line text-ink-muted hover:text-ink hover:border-accent"
            )}
          >
            <span aria-hidden="true" className={cn("w-2 h-2 rounded-full shrink-0", priorityClass(p))} />
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
  const [value, setValue] = useSyncedState(initialDeadline ? initialDeadline.slice(0, 10) : "");

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

  const overdue = value !== "" && isPast(value);

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", pending && "opacity-60")}>
      <input
        type="date"
        value={value}
        onChange={(e) => save(e.target.value)}
        aria-label={t("cardDeadline", locale)}
        className={cn("!py-1 !text-sm w-auto", overdue && "text-danger border-danger")}
      />
      {value === "" ? (
        <span className="text-xs text-ink-muted">{t("cardNoDeadline", locale)}</span>
      ) : (
        <>
          {overdue && (
            <span className="text-xs font-medium text-danger">{t("cardOverdue", locale)}</span>
          )}
          <button
            type="button"
            onClick={() => save("")}
            aria-label={t("remove", locale)}
            title={t("remove", locale)}
            className={iconButtonClass("w-7 h-7 hover:text-danger")}
          >
            &times;
          </button>
        </>
      )}
    </div>
  );
}

const COVER_PRESETS: string[] = [...PALETTE];

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
  const [value, setValue] = useSyncedState(initialColor);

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
                ? "ring-2 ring-offset-1 ring-offset-surface ring-accent"
                : "ring-1 ring-line hover:scale-110"
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
          "w-6 h-6 rounded-full border border-dashed border-line-strong flex items-center justify-center text-xs leading-none",
          !value ? "ring-2 ring-accent text-ink" : "text-ink-muted hover:text-ink"
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
            title={`${t("remove", locale)}: ${u.displayName ?? u.username}`}
            className="group relative rounded-full focus:outline-none focus:ring-2 focus:ring-accent"
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
          className="w-7 h-7 rounded-full border border-dashed border-line-strong flex items-center justify-center text-base leading-none text-ink-muted hover:text-ink hover:border-accent"
        >
          +
        </button>
        {assignees.length === 0 && (
          <span className="text-sm text-ink-muted">{t("cardNoAssignees", locale)}</span>
        )}
      </div>
      {open && (
        <div className="absolute mt-2 z-50 w-64 bg-raised border border-line rounded-panel shadow-float max-h-72 overflow-auto p-1">
          {members.length === 0 && (
            <div className="px-3 py-2 text-sm text-ink-muted">{t("noResults", locale)}</div>
          )}
          {members.map((u) => {
            const on = assignedIds.has(u.id);
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => toggle(u.id)}
                className={cn(
                  "flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-control hover:bg-ink/5",
                  on && "bg-accent-soft"
                )}
              >
                <Avatar src={u.avatarUrl} name={u.displayName ?? u.username} size={22} />
                <span className="text-sm flex-1 truncate">{u.displayName ?? u.username}</span>
                {on && <span className="text-accent">&#10003;</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
