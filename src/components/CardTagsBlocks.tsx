"use client";

import { useOptimistic, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { chipStyle } from "@/lib/palette";
import { Plus, X } from "lucide-react";
import { buttonClass, iconButtonClass } from "./ui/button";
import Combobox from "./ui/Combobox";
import { useUi } from "./ui/UiProvider";
import { addBlockAction, removeBlockAction, toggleCardTagAction } from "@/server/tasks-actions";

export interface CardTagsProps {
  cardId: string;
  boardTags: { id: string; name: string; color: string }[];
  selectedTagIds: string[];
  locale: Locale;
}

export function CardTags({ cardId, boardTags, selectedTagIds, locale }: CardTagsProps) {
  const router = useRouter();
  const ui = useUi();
  const [pending, startTransition] = useTransition();
  const [selectedIds, toggleOptimistic] = useOptimistic(selectedTagIds, (ids: string[], tagId: string) =>
    ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId]
  );
  const set = new Set(selectedTagIds);
  const selected = boardTags.filter((tag) => set.has(tag.id));

  function toggle(tagId: string) {
    startTransition(async () => {
      toggleOptimistic(tagId);
      const fd = new FormData();
      fd.set("cardId", cardId);
      fd.set("tagId", tagId);
      ui.report(await toggleCardTagAction(fd));
      router.refresh();
    });
  }

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", pending && "opacity-60")}>
      {selected.map((tag) => (
        <button
          key={tag.id}
          type="button"
          onClick={() => toggle(tag.id)}
          aria-label={`${t("remove", locale)}: ${tag.name}`}
          title={`${t("remove", locale)}: ${tag.name}`}
          className="chip group inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-control font-medium focus:outline-none focus:ring-2 focus:ring-accent"
          style={chipStyle(tag.color) as CSSProperties}
        >
          {tag.name}
          <span aria-hidden="true">&times;</span>
        </button>
      ))}
      <Combobox
        selectionMode="multiple"
        label={t("cardAddTag", locale)}
        searchLabel={t("pickerSearchTags", locale)}
        emptyText={t("pickerNoMatches", locale)}
        selectedIds={selectedIds}
        onToggle={toggle}
        options={boardTags.map((tag) => ({
          id: tag.id,
          label: tag.name,
          leading: <span aria-hidden className="w-3 h-3 rounded-full shrink-0" style={{ background: tag.color }} />,
        }))}
        trigger={<Plus size={14} aria-hidden />}
        triggerClassName="w-6 h-6 rounded-full border border-dashed border-line-strong flex items-center justify-center text-ink-muted hover:text-ink hover:border-accent"
      />
      {selected.length === 0 && <span className="text-sm text-ink-muted">{t("cardNoTags", locale)}</span>}
    </div>
  );
}

export interface CardBlocksProps {
  boardId: string;
  cardId: string;
  blocking: { blockId: string; cardId: string; cardTitle: string }[];
  blockedBy: { blockId: string; cardId: string; cardTitle: string }[];
  /** Cards on the board that can block this one (not itself, not already linked). */
  candidates: { id: string; title: string; columnName: string }[];
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
  const ui = useUi();
  const [pending, startTransition] = useTransition();

  function addBlocker(blockerId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("blockerId", blockerId);
      fd.set("blockedId", cardId);
      ui.report(await addBlockAction(fd));
      router.refresh();
    });
  }

  return (
    <div className={cn("grid sm:grid-cols-2 gap-4", pending && "opacity-60")}>
      <BlocksColumn
        title={t("cardBlockedBy", locale)}
        items={blockedBy}
        boardId={boardId}
        emptyText={t("none", locale)}
        locale={locale}
      />
      <BlocksColumn
        title={t("cardBlocking", locale)}
        items={blocking}
        boardId={boardId}
        emptyText={t("none", locale)}
        locale={locale}
      />
      <div className="sm:col-span-2">
        <Combobox
          label={t("cardAddBlocker", locale)}
          searchLabel={t("pickerSearchCards", locale)}
          emptyText={t("pickerNoMatches", locale)}
          onSelect={addBlocker}
          options={candidates.map((c) => ({ id: c.id, label: c.title, description: c.columnName }))}
          trigger={
            <>
              <Plus size={14} aria-hidden />
              {t("cardAddBlocker", locale)}
            </>
          }
          triggerClassName={buttonClass("secondary", "sm")}
        />
      </div>
    </div>
  );
}

function BlocksColumn({
  title,
  items,
  boardId,
  emptyText,
  locale,
}: {
  title: string;
  items: { blockId: string; cardId: string; cardTitle: string }[];
  boardId: string;
  emptyText: string;
  locale: Locale;
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
                <button
                  aria-label={`${t("remove", locale)}: ${it.cardTitle}`}
                  title={`${t("remove", locale)}: ${it.cardTitle}`}
                  className={iconButtonClass("w-6 h-6 hover:text-danger")}
                >
                  <X size={14} aria-hidden />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
