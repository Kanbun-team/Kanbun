import Link from "next/link";
import { Clock } from "lucide-react";
import Avatar from "./Avatar";
import PinButton from "./home/PinButton";
import { t, tn, type Locale } from "@/lib/i18n";
import { readableOn } from "@/lib/palette";
import { cn } from "@/lib/utils";

export interface BoardMemberData {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface BoardCardData {
  id: string;
  name: string;
  description: string | null;
  color: string;
  archived: boolean;
  categoryId: string | null;
  position: number;
  pinned: boolean;
  /** Up to four active members, for the avatar stack. */
  members: BoardMemberData[];
  membersCount: number;
  /** Cards outside the board's last column. */
  openCount: number;
  /** Open cards whose deadline is before today. */
  overdueCount: number;
  /** Cards in the board's last column. */
  doneCount: number;
  totalCount: number;
}

const MAX_AVATARS = 4;

export const BOARD_GRID_CLASS = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr";

// A board tile on the boards home. The whole tile is clickable through a
// stretched link (the name), so the pin toggle can sit beside it as a real
// button instead of being nested inside the link.
export default function BoardCard({
  board,
  locale,
  muted = false,
}: {
  board: BoardCardData;
  locale: Locale;
  /** De-emphasized look for archived boards. */
  muted?: boolean;
}) {
  const initial = (board.name.trim().charAt(0) || "?").toUpperCase();
  const extraMembers = board.membersCount - Math.min(board.members.length, MAX_AVATARS);
  const progress = board.totalCount > 0 ? Math.round((board.doneCount / board.totalCount) * 100) : 0;

  return (
    <div
      data-board-tile={board.id}
      className={cn(
        "group relative flex flex-col h-full rounded-panel border p-4 transition-[border-color,box-shadow,transform] duration-[120ms] [&_*]:select-none",
        muted
          ? "bg-paper border-line hover:border-line-strong"
          : "bg-surface border-line hover:border-line-strong hover:shadow-card motion-safe:hover:-translate-y-0.5"
      )}
    >
      <div className="flex items-start gap-3 pr-8">
        <span
          aria-hidden="true"
          className={cn(
            "shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-card font-semibold text-white text-base",
            muted && "grayscale"
          )}
          style={{ background: readableOn(board.color, "#ffffff", "#000000") }}
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base leading-snug truncate">
            <Link
              href={`/tasks/${board.id}`}
              draggable={false}
              className="focus-visible:outline-none after:absolute after:inset-0 after:rounded-panel focus-visible:after:ring-2 focus-visible:after:ring-accent"
            >
              {board.name}
            </Link>
          </h3>
          {board.description && <p className="text-sm text-ink-muted truncate mt-0.5">{board.description}</p>}
        </div>
      </div>

      <PinButton
        boardId={board.id}
        boardName={board.name}
        pinned={board.pinned}
        className="absolute top-3 right-3 z-10"
      />

      <div className="flex-grow" />

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-sm text-ink-muted tabular-nums">
          <span>{t("boardOpenCards", locale).replace("{count}", String(board.openCount))}</span>
          {board.overdueCount > 0 && (
            <span className="inline-flex items-center gap-1 text-danger font-medium">
              <Clock size={14} aria-hidden />
              {t("boardOverdueCards", locale).replace("{count}", String(board.overdueCount))}
            </span>
          )}
        </div>
        {board.membersCount > 0 && (
          <span className="flex items-center shrink-0">
            <span className="flex -space-x-1.5" aria-hidden="true">
              {board.members.slice(0, MAX_AVATARS).map((m) => (
                <Avatar
                  key={m.id}
                  src={m.avatarUrl}
                  name={m.displayName ?? m.username}
                  size={24}
                  className={cn("rounded-full ring-2", muted ? "ring-paper" : "ring-surface")}
                />
              ))}
              {extraMembers > 0 && (
                <span
                  className={cn(
                    "relative w-6 h-6 rounded-full ring-2 bg-line text-ink text-xs font-semibold flex items-center justify-center tabular-nums",
                    muted ? "ring-paper" : "ring-surface"
                  )}
                >
                  +{extraMembers}
                </span>
              )}
            </span>
            <span className="sr-only">
              {tn("boardMembersA11y", board.membersCount, locale)}
            </span>
          </span>
        )}
      </div>

      {board.totalCount > 0 && (
        <div className="mt-3">
          <div aria-hidden="true" className="h-1 rounded-full bg-line overflow-hidden">
            <div className="h-full rounded-full bg-success" style={{ width: `${progress}%` }} />
          </div>
          <span className="sr-only">
            {tn("boardProgressA11y", board.totalCount, locale).replace("{done}", String(board.doneCount))}
          </span>
        </div>
      )}
    </div>
  );
}
