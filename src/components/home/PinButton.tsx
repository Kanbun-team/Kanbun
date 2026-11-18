"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { setBoardPinAction } from "@/server/board-pins-actions";
import { useUi } from "@/components/ui/UiProvider";
import { iconButtonClass } from "@/components/ui/button";
import { useSyncedState } from "@/lib/use-synced-state";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Star toggle on a board tile. Flips immediately, rolls back if the server
// refuses, then refreshes so the "Pinned" section matches.
export default function PinButton({
  boardId,
  boardName,
  pinned: initial,
  className,
}: {
  boardId: string;
  boardName: string;
  pinned: boolean;
  className?: string;
}) {
  const { locale, report } = useUi();
  const router = useRouter();
  const [pinned, setPinned] = useSyncedState(initial);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !pinned;
    setPinned(next);
    startTransition(async () => {
      const result = report(await setBoardPinAction({ boardId, pinned: next }));
      if (!result.ok) setPinned(!next);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={t("boardPin", locale).replace("{name}", boardName)}
      title={t("boardPin", locale).replace("{name}", boardName)}
      // Not `disabled` while saving: that would drop keyboard focus.
      onClick={() => {
        if (!pending) toggle();
      }}
      draggable={false}
      className={iconButtonClass(cn(pinned && "text-accent hover:text-accent", className))}
    >
      <Star size={16} aria-hidden fill={pinned ? "currentColor" : "none"} />
    </button>
  );
}
