"use client";

import type { Locale } from "@/lib/i18n";
import CardSheet from "./CardSheet";
import OfflineCardView, { type BoardCardFallback } from "./OfflineCardView";

// A card opened from the board while offline: its stored details in the same
// side panel the online card uses, without a route change (the server can
// not render the card panel offline).
export default function OfflineCardSheet({
  boardId,
  cardId,
  userId,
  locale,
  fallback,
  onClose,
}: {
  boardId: string;
  cardId: string;
  userId: string;
  locale: Locale;
  fallback?: BoardCardFallback;
  onClose: () => void;
}) {
  return (
    <CardSheet boardHref={`/tasks/${boardId}`} locale={locale} onClose={onClose}>
      <OfflineCardView key={cardId} boardId={boardId} cardId={cardId} userId={userId} locale={locale} fallback={fallback} />
    </CardSheet>
  );
}
