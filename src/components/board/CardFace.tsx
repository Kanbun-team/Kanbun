"use client";

import { Clock, Lock, ListChecks, MessageSquare, Paperclip } from "lucide-react";
import Avatar from "@/components/Avatar";
import TagChip from "@/components/ui/TagChip";
import { cn } from "@/lib/utils";
import { formatDate, t, tn, type Locale } from "@/lib/i18n";
import { priorityLabel } from "@/lib/labels";
import { relativeDeadline } from "@/lib/deadline";
import type { CardDTO } from "./types";

// The card face (DESIGN.md 4.1). Quiet by default: priority shows only for
// High and Critical (a notch on the left edge), deadlines are relative and
// turn amber when due within a day and vermilion when late.
export default function CardFace({ card, locale }: { card: CardDTO; locale: Locale }) {
  const deadline = card.deadline ? relativeDeadline(card.deadline, locale) : null;
  const notch = card.priority === "critical" ? "bg-danger" : card.priority === "high" ? "bg-warning" : null;
  const extra = card.assignees.length - 3;

  return (
    <>
      {notch && <span aria-hidden className={cn("absolute left-0 top-0 bottom-0 w-[3px]", notch)} />}
      {card.coverColor && (
        <span aria-hidden className="absolute left-0 right-0 top-0 h-1" style={{ background: card.coverColor }} />
      )}
      <span className="block text-base font-medium leading-snug line-clamp-3 break-words pr-6">{card.title}</span>
      {notch && <span className="sr-only">, {t("cardPriorityA11y", locale).replace("{priority}", priorityLabel(card.priority, locale))}</span>}
      {card.tags.length > 0 && (
        <span className="flex flex-wrap gap-1 mt-2">
          {card.tags.map((tag) => (
            <TagChip key={tag.id} name={tag.name} color={tag.color} />
          ))}
        </span>
      )}
      {(deadline || card.subtasksTotal > 0 || card.commentsCount > 0 || card.attachmentsCount > 0 || card.blockedByCount > 0 || card.assignees.length > 0) && (
        <span className="mt-2 flex items-center justify-between gap-2 text-sm text-ink-muted">
          <span className="flex items-center gap-x-3 gap-y-1 flex-wrap tabular-nums">
            {deadline && (
              <span
                title={formatDate(new Date(card.deadline!), locale)}
                className={cn(
                  "inline-flex items-center gap-1",
                  deadline.tone === "late" && "text-danger font-medium",
                  deadline.tone === "soon" && "text-warning font-medium"
                )}
              >
                <Clock size={14} aria-hidden />
                {deadline.tone === "late" && <span className="sr-only">{t("cardOverdue", locale)}: </span>}
                {deadline.label}
              </span>
            )}
            {card.subtasksTotal > 0 && (
              <span className={cn("inline-flex items-center gap-1", card.subtasksDone === card.subtasksTotal && "text-success")}>
                <ListChecks size={14} aria-hidden />
                <span aria-hidden>
                  {card.subtasksDone}/{card.subtasksTotal}
                </span>
                <span className="sr-only">
                  {tn("cardSubtasksA11y", card.subtasksTotal, locale).replace("{done}", String(card.subtasksDone))}
                </span>
              </span>
            )}
            {card.commentsCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <MessageSquare size={14} aria-hidden />
                <span aria-hidden>{card.commentsCount}</span>
                <span className="sr-only">{tn("cardCommentsA11y", card.commentsCount, locale)}</span>
              </span>
            )}
            {card.attachmentsCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Paperclip size={14} aria-hidden />
                <span aria-hidden>{card.attachmentsCount}</span>
                <span className="sr-only">{tn("cardAttachmentsA11y", card.attachmentsCount, locale)}</span>
              </span>
            )}
            {card.blockedByCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-control px-1.5 py-px text-xs font-medium bg-danger/10 text-danger">
                <Lock size={12} aria-hidden />
                {t("cardBlocked", locale)}
              </span>
            )}
          </span>
          {card.assignees.length > 0 && (
            <span className="flex -space-x-1.5 shrink-0">
              {card.assignees.slice(0, 3).map((u) => (
                <Avatar
                  key={u.id}
                  src={u.avatarUrl}
                  name={u.displayName ?? u.username}
                  size={22}
                  className="rounded-full ring-2 ring-raised"
                />
              ))}
              {extra > 0 && (
                <span className="relative w-[22px] h-[22px] rounded-full ring-2 ring-raised bg-line text-ink text-xs font-semibold flex items-center justify-center">
                  +{extra}
                </span>
              )}
            </span>
          )}
        </span>
      )}
    </>
  );
}
