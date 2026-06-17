"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { addBlockAction, removeBlockAction, toggleCardTagAction } from "@/server/tasks-actions";

export interface CardTagsProps {
  cardId: string;
  boardTags: { id: string; name: string; color: string }[];
  selectedTagIds: string[];
  locale: Locale;
}

export function CardTags({ cardId, boardTags, selectedTagIds, locale }: CardTagsProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);
  const set = new Set(selectedTagIds);
  const selected = boardTags.filter((tag) => set.has(tag.id));

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  function toggle(tagId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("cardId", cardId);
      fd.set("tagId", tagId);
      await toggleCardTagAction(fd);
      router.refresh();
    });
  }

  return (
    <div className="relative" ref={wrapRef}>
      <div className={cn("flex items-center gap-1.5 flex-wrap", pending && "opacity-60")}>
        {selected.map((tag) => (
          <button
            key={tag.id}
            type="button"
            onClick={() => toggle(tag.id)}
            title={`${tag.name} — ${t("remove", locale)}`}
            className="group inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500"
            style={{ background: tag.color + "33", color: tag.color }}
          >
            {tag.name}
            <span className="opacity-50 group-hover:opacity-100">&times;</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={t("add", locale)}
          aria-expanded={open}
          className="w-6 h-6 rounded-full border border-dashed border-[var(--border)] flex items-center justify-center text-sm leading-none opacity-70 hover:opacity-100 hover:border-brand-500"
        >
          +
        </button>
        {selected.length === 0 && (
          <span className="text-sm opacity-50">{t("cardNoTags", locale)}</span>
        )}
      </div>
      {open && (
        <div className="absolute mt-2 z-50 w-60 surface border rounded-lg shadow-lg p-1 max-h-64 overflow-auto">
          {boardTags.length === 0 && (
            <p className="text-sm opacity-60 px-2 py-1">{t("noResults", locale)}</p>
          )}
          {boardTags.map((tag) => {
            const on = set.has(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggle(tag.id)}
                className={cn(
                  "flex items-center gap-2 w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800",
                  on && "bg-slate-50 dark:bg-slate-800/50"
                )}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: tag.color }} />
                <span className="text-sm flex-1 truncate">{tag.name}</span>
                {on && <span className="text-brand-600">&#10003;</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface CardBlocksProps {
  boardId: string;
  cardId: string;
  blocking: { blockId: string; cardId: string; cardTitle: string }[];
  blockedBy: { blockId: string; cardId: string; cardTitle: string }[];
  candidates: { id: string; title: string }[];
  locale: Locale;
}

export function CardBlocks({
  boardId,
  cardId,
  blocking,
  blockedBy,
  candidates,
  locale,
}: CardBlocksProps) {
  const router = useRouter();
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <BlocksColumn
        title={t("cardBlockedBy", locale)}
        items={blockedBy}
        boardId={boardId}
        emptyText={t("none", locale)}
      />
      <BlocksColumn
        title={t("cardBlocking", locale)}
        items={blocking}
        boardId={boardId}
        emptyText={t("none", locale)}
      />
      <form
        action={async (fd) => {
          await addBlockAction(fd);
          router.refresh();
        }}
        className="sm:col-span-2 flex flex-wrap items-end gap-2 surface border rounded-lg p-3"
      >
        <input type="hidden" name="blockedId" value={cardId} />
        <label className="flex-1 min-w-[200px]">
          <span className="text-xs opacity-70">{t("cardBlockedBy", locale)}</span>
          <select name="blockerId" required className="mt-1">
            <option value="">{t("cardBlockSelectCard", locale)}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded bg-brand-600 hover:bg-brand-700 text-white text-sm px-3 py-1">
          {t("cardBlockAdd", locale)}
        </button>
      </form>
    </div>
  );
}

function BlocksColumn({
  title,
  items,
  boardId,
  emptyText,
}: {
  title: string;
  items: { blockId: string; cardId: string; cardTitle: string }[];
  boardId: string;
  emptyText: string;
}) {
  const router = useRouter();
  return (
    <div className="surface border rounded-lg p-3">
      <div className="text-xs uppercase tracking-wide opacity-60 mb-2">{title}</div>
      {items.length === 0 ? (
        <p className="text-sm opacity-60">{emptyText}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((it) => (
            <li key={it.blockId} className="flex items-center justify-between gap-2">
              <Link
                href={`/tasks/${boardId}/cards/${it.cardId}`}
                className="hover:underline truncate"
              >
                {it.cardTitle}
              </Link>
              <form
                action={async (fd) => {
                  await removeBlockAction(fd);
                  router.refresh();
                }}
              >
                <input type="hidden" name="blockId" value={it.blockId} />
                <button className="text-xs opacity-50 hover:opacity-100">&times;</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
