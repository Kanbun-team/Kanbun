"use client";

import Avatar from "@/components/Avatar";
import { useBoardViewers, useViewingCard } from "@/lib/board-stream";
import { t, type Locale } from "@/lib/i18n";
import type { PresenceViewer } from "@/lib/presence";
import { cn } from "@/lib/utils";

const MAX_STACK = 4;

function fill(template: string, vars: Record<string, string | number>) {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), template);
}

function AvatarStack({ viewers, size, ringClass }: { viewers: PresenceViewer[]; size: number; ringClass: string }) {
  const extra = viewers.length - MAX_STACK;
  return (
    <span aria-hidden className="flex -space-x-1.5">
      {viewers.slice(0, MAX_STACK).map((v) => (
        <Avatar key={v.id} src={v.avatarUrl} name={v.name} size={size} className={cn("rounded-full ring-2", ringClass)} />
      ))}
      {extra > 0 && (
        <span
          className={cn("relative rounded-full ring-2 bg-line text-ink text-xs font-semibold flex items-center justify-center", ringClass)}
          style={{ width: size, height: size }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

/** Avatars of the other people looking at the board, for the board header. */
export function BoardPresence({ boardId, currentUserId, locale }: { boardId: string; currentUserId: string; locale: Locale }) {
  const others = useBoardViewers(boardId).filter((v) => v.id !== currentUserId);
  if (others.length === 0) return null;
  const names = others.map((v) => v.name).join(", ");
  const label = fill(t("presenceBoardLabel", locale), { names });
  return (
    <div role="img" aria-label={label} title={label} data-testid="board-presence" className="flex items-center">
      <AvatarStack viewers={others} size={28} ringClass="ring-paper" />
    </div>
  );
}

/**
 * Marks the card as open in this tab and says who else has it open. Rendered
 * in the card detail (panel and full page).
 */
export function CardPresence({
  boardId,
  cardId,
  currentUserId,
  locale,
}: {
  boardId: string;
  cardId: string;
  currentUserId: string;
  locale: Locale;
}) {
  useViewingCard(boardId, cardId);
  const others = useBoardViewers(boardId).filter((v) => v.id !== currentUserId && v.cardIds.includes(cardId));
  let text = "";
  if (others.length === 1) text = fill(t("presenceCardOne", locale), { name: others[0].name });
  else if (others.length === 2) text = fill(t("presenceCardTwo", locale), { a: others[0].name, b: others[1].name });
  else if (others.length > 2) text = fill(t("presenceCardMany", locale), { name: others[0].name, count: others.length - 1 });
  // The live region stays mounted so arrivals are announced politely.
  return (
    <div role="status" className={cn(others.length === 0 && "sr-only")}>
      {others.length > 0 && (
        <p className="inline-flex items-center gap-2 rounded-full bg-accent-soft text-ink pl-1 pr-3 py-1 text-sm">
          <AvatarStack viewers={others} size={22} ringClass="ring-accent-soft" />
          {text}
        </p>
      )}
    </div>
  );
}

/** Small avatar on a card face when someone else has that card open. */
export function CardFaceViewers({
  boardId,
  cardId,
  currentUserId,
  locale,
}: {
  boardId: string;
  cardId: string;
  currentUserId: string;
  locale: Locale;
}) {
  const others = useBoardViewers(boardId).filter((v) => v.id !== currentUserId && v.cardIds.includes(cardId));
  if (others.length === 0) return null;
  const label = fill(t("presenceCardFace", locale), { names: others.map((v) => v.name).join(", ") });
  return (
    <span
      className="pointer-events-none absolute -left-1.5 -top-1.5 z-[1]"
      title={label}
      data-testid="card-face-viewers"
    >
      <span aria-hidden>
        <Avatar src={others[0].avatarUrl} name={others[0].name} size={18} className="rounded-full ring-2 ring-paper" />
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
