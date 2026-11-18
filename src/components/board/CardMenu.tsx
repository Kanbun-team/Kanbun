"use client";

import Avatar from "@/components/Avatar";
import { MenuButton, MenuItem, MenuSeparator, Submenu } from "@/components/ui/Menu";
import { PALETTE } from "@/lib/palette";
import { PRIORITIES, priorityClass, priorityLabel } from "@/lib/labels";
import { t, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CardDTO, MemberOption, TagOption } from "./types";

export interface CardMenuHandlers {
  open: (card: CardDTO) => void;
  moveTo: (card: CardDTO) => void;
  toggleAssignee: (card: CardDTO, user: MemberOption) => void;
  toggleTag: (card: CardDTO, tag: TagOption) => void;
  setPriority: (card: CardDTO, priority: string) => void;
  setCover: (card: CardDTO, color: string | null) => void;
  setDeadline: (card: CardDTO) => void;
  remove: (card: CardDTO) => void;
}

// One menu for the card's "..." button and its right-click context menu.
export default function CardMenu({
  card,
  members,
  boardTags,
  currentUserId,
  locale,
  handlers,
  isOpen,
  onOpenChange,
}: {
  card: CardDTO;
  members: MemberOption[];
  boardTags: TagOption[];
  currentUserId: string;
  locale: Locale;
  handlers: CardMenuHandlers;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const assigned = new Set(card.assignees.map((a) => a.id));
  const tagged = new Set(card.tags.map((tg) => tg.id));
  const me = members.find((m) => m.id === currentUserId);

  return (
    <MenuButton
      label={t("cardActions", locale).replace("{title}", card.title)}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className="bg-raised/90"
    >
      <MenuItem onAction={() => handlers.open(card)}>{t("cardOpen", locale)}</MenuItem>
      <MenuItem onAction={() => handlers.moveTo(card)}>{t("cardMoveTo", locale)}</MenuItem>
      <MenuItem onAction={() => handlers.setDeadline(card)}>{t("cardSetDeadline", locale)}</MenuItem>
      {me && (
        <MenuItem onAction={() => handlers.toggleAssignee(card, me)}>
          {assigned.has(me.id) ? t("cardUnassignMe", locale) : t("cardAssignMe", locale)}
        </MenuItem>
      )}
      <MenuSeparator />
      <Submenu label={t("cardAssignees", locale)}>
        {members.length === 0 ? (
          <MenuItem isDisabled>{t("noResults", locale)}</MenuItem>
        ) : (
          members.map((u) => (
            <MenuItem
              key={u.id}
              textValue={u.displayName ?? u.username}
              checked={assigned.has(u.id)}
              onAction={() => handlers.toggleAssignee(card, u)}
            >
              <Avatar src={u.avatarUrl} name={u.displayName ?? u.username} size={20} />
              <span className="truncate">{u.displayName ?? u.username}</span>
            </MenuItem>
          ))
        )}
      </Submenu>
      <Submenu label={t("cardTags", locale)}>
        {boardTags.length === 0 ? (
          <MenuItem isDisabled>{t("noResults", locale)}</MenuItem>
        ) : (
          boardTags.map((tg) => (
            <MenuItem key={tg.id} textValue={tg.name} checked={tagged.has(tg.id)} onAction={() => handlers.toggleTag(card, tg)}>
              <span aria-hidden className="w-3 h-3 rounded-full shrink-0" style={{ background: tg.color }} />
              <span className="truncate">{tg.name}</span>
            </MenuItem>
          ))
        )}
      </Submenu>
      <Submenu label={t("cardPriority", locale)}>
        {PRIORITIES.map((p) => (
          <MenuItem key={p} textValue={priorityLabel(p, locale)} checked={card.priority === p} onAction={() => handlers.setPriority(card, p)}>
            <span aria-hidden className={cn("w-2.5 h-2.5 rounded-full shrink-0", priorityClass(p))} />
            {priorityLabel(p, locale)}
          </MenuItem>
        ))}
      </Submenu>
      <Submenu label={t("cardCover", locale)}>
        <MenuItem textValue={t("none", locale)} checked={!card.coverColor} onAction={() => handlers.setCover(card, null)}>
          <span aria-hidden className="w-3 h-3 rounded-full shrink-0 border border-dashed border-line-strong" />
          {t("none", locale)}
        </MenuItem>
        {PALETTE.map((c) => (
          <MenuItem key={c} textValue={c} checked={card.coverColor?.toLowerCase() === c} onAction={() => handlers.setCover(card, c)}>
            <span aria-hidden className="w-3 h-3 rounded-full shrink-0" style={{ background: c }} />
            <span className="text-sm text-ink-muted">{c.toUpperCase()}</span>
          </MenuItem>
        ))}
      </Submenu>
      <MenuSeparator />
      <MenuItem danger onAction={() => handlers.remove(card)}>
        {t("cardDelete", locale)}
      </MenuItem>
    </MenuButton>
  );
}
