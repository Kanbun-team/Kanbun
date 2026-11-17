import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";
import { readableOn } from "@/lib/palette";

export interface BoardCardData {
  id: string;
  name: string;
  description: string | null;
  color: string;
  archived: boolean;
  columnsCount: number;
  membersCount: number;
}

function Dot() {
  return <span className="inline-block w-1 h-1 rounded-full bg-current" />;
}

export default function BoardCard({ board, locale }: { board: BoardCardData; locale: Locale }) {
  const initial = (board.name.trim().charAt(0) || "?").toUpperCase();
  return (
    <Link
      href={`/tasks/${board.id}`}
      draggable={false}
      className="group flex flex-col h-full min-h-[160px] bg-surface border border-line rounded-panel p-4 transition hover:-translate-y-0.5 hover:shadow-float hover:border-[color:var(--board-color)] [&_*]:select-none"
      style={{ ["--board-color" as string]: board.color }}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-card font-semibold text-white text-base shadow-card"
          style={{ background: readableOn(board.color, "#ffffff", "#000000") }}
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold truncate text-[15px] leading-tight">{board.name}</h2>
            {board.archived && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-control bg-ink/5 text-ink-muted shrink-0">
                {t("boardArchived", locale)}
              </span>
            )}
          </div>
          <p className="text-sm text-ink-muted mt-1 line-clamp-2 min-h-[2.5em]">
            {board.description ?? ""}
          </p>
        </div>
      </div>
      <div className="flex-grow" />
      <div className="mt-4 flex items-center gap-3 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <Dot /> {board.columnsCount} cols
        </span>
        <span className="inline-flex items-center gap-1">
          <Dot /> {board.membersCount} {t("boardMembers", locale).toLowerCase()}
        </span>
      </div>
    </Link>
  );
}
