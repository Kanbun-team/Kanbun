"use client";

import { useEffect, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import type { StoredCard } from "@/lib/offline-card";
import { ensureUser, saveCard } from "@/lib/offline-store";
import { useOnline } from "@/lib/use-online";
import OfflineCardView from "./OfflineCardView";

// Mounted in the card view (panel and full page): stores the details the
// server rendered for offline reading. On the full page (`gate`), while
// offline the stored details are shown read-only instead; the live view stays
// mounted but hidden, so a draft typed into it is still there on reconnect.
export default function CardOffline({
  record,
  userId,
  locale,
  gate,
  children,
}: {
  record: StoredCard;
  userId: string;
  locale: Locale;
  gate: boolean;
  children: ReactNode;
}) {
  const online = useOnline();
  useEffect(() => {
    // A page answered from the offline cache is old: do not store it as new.
    if (!navigator.onLine) return;
    ensureUser(userId);
    void saveCard(record).catch(() => undefined);
  }, [record, userId]);

  if (!gate || online) return <>{children}</>;
  return (
    <>
      <div hidden>{children}</div>
      <OfflineCardView
        key={record.card.id}
        boardId={record.card.boardId}
        cardId={record.card.id}
        userId={userId}
        locale={locale}
        initial={record}
      />
    </>
  );
}
