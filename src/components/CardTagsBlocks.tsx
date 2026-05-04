"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";
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
  const set = new Set(selectedTagIds);
  const selected = boardTags.filter((t) => set.has(t.id));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {selected.length === 0 && (
          <span className="text-sm opacity-60">{t("cardNoTags", locale)}</span>
        )}
        {selected.map((tag) => (
          <span
            key={tag.id}
            className="text-xs px-2 py-0.5 rounded font-semibold"
            style={{ background: tag.color + "33", color: tag.color }}
          >
            {tag.name}
          </span>
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
        <div className="surface border rounded-lg p-2 max-h-64 overflow-auto">
          {boardTags.length === 0 && (
            <p className="text-sm opacity-60 px-2 py-1">{t("noResults", locale)}</p>
          )}
          {boardTags.map((tag) => (
            <form
              key={tag.id}
              action={async (fd) => {
                await toggleCardTagAction(fd);
                router.refresh();
              }}
            >
              <input type="hidden" name="cardId" value={cardId} />
              <input type="hidden" name="tagId" value={tag.id} />
              <button
                type="submit"
                className="flex items-center gap-2 w-full text-left px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ background: tag.color }}
                />
                <span className="text-sm flex-1">{tag.name}</span>
                {set.has(tag.id) && <span className="text-brand-600">&#10003;</span>}
              </button>
            </form>
          ))}
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
