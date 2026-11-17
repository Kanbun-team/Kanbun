"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { chipStyle } from "@/lib/palette";
import { buttonClass } from "./ui/button";
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
            title={`${t("remove", locale)}: ${tag.name}`}
            className="chip group inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-control font-medium focus:outline-none focus:ring-2 focus:ring-accent"
            style={chipStyle(tag.color) as CSSProperties}
          >
            {tag.name}
            <span aria-hidden="true">&times;</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={t("add", locale)}
          aria-expanded={open}
          className="w-6 h-6 rounded-full border border-dashed border-line-strong flex items-center justify-center text-sm leading-none text-ink-muted hover:text-ink hover:border-accent"
        >
          +
        </button>
        {selected.length === 0 && (
          <span className="text-sm text-ink-muted">{t("cardNoTags", locale)}</span>
        )}
      </div>
      {open && (
        <div className="absolute mt-2 z-50 w-60 bg-raised border border-line rounded-panel shadow-float p-1 max-h-64 overflow-auto">
          {boardTags.length === 0 && (
            <p className="text-sm text-ink-muted px-2 py-1">{t("noResults", locale)}</p>
          )}
          {boardTags.map((tag) => {
            const on = set.has(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggle(tag.id)}
                className={cn(
                  "flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-control hover:bg-ink/5",
                  on && "bg-accent-soft"
                )}
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: tag.color }} />
                <span className="text-sm flex-1 truncate">{tag.name}</span>
                {on && <span className="text-accent">&#10003;</span>}
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
        className="sm:col-span-2 flex flex-wrap items-end gap-2 bg-surface border border-line rounded-panel p-3"
      >
        <input type="hidden" name="blockedId" value={cardId} />
        <label className="flex-1 min-w-[200px]">
          <span className="text-sm font-medium text-ink-muted">{t("cardBlockedBy", locale)}</span>
          <select name="blockerId" required className="mt-1">
            <option value="">{t("cardBlockSelectCard", locale)}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <button className={buttonClass("primary")}>
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
    <div className="bg-surface border border-line rounded-panel p-3">
      <div className="text-sm font-medium text-ink-muted mb-2">{title}</div>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">{emptyText}</p>
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
                <button className="text-xs text-ink-muted hover:text-ink">&times;</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
