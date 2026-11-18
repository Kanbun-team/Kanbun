"use client";

import { useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useUi } from "@/components/ui/UiProvider";
import { buttonClass } from "@/components/ui/button";
import { useSyncedState } from "@/lib/use-synced-state";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toggleBoardWatchAction, toggleCardWatchAction } from "@/server/watch-actions";

// "Watch" / "Watching" toggle for a card or a board. Flips immediately and
// rolls back if the server refuses. The visible text names the state, so it
// is the accessible name too; a toast confirms the change.
export default function WatchButton({
  kind,
  id,
  watching: initial,
}: {
  kind: "card" | "board";
  id: string;
  watching: boolean;
}) {
  const { locale, report, toast } = useUi();
  const [watching, setWatching] = useSyncedState(initial);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !watching;
    setWatching(next);
    startTransition(async () => {
      const action = kind === "card" ? toggleCardWatchAction : toggleBoardWatchAction;
      const result = report(await action(id));
      if (!result.ok) {
        setWatching(!next);
        return;
      }
      setWatching(result.data.watching);
      const key = result.data.watching
        ? kind === "card" ? "watchCardOn" : "watchBoardOn"
        : kind === "card" ? "watchCardOff" : "watchBoardOff";
      toast({ message: t(key, locale) });
    });
  }

  const Icon = watching ? Eye : EyeOff;
  return (
    <button
      type="button"
      onClick={() => {
        if (!pending) toggle();
      }}
      title={t(kind === "card" ? "watchCardHint" : "watchBoardHint", locale)}
      data-watching={watching || undefined}
      className={buttonClass("ghost", "sm", cn(watching && "text-accent hover:text-accent"))}
    >
      <Icon size={16} aria-hidden />
      {watching ? t("watching", locale) : t("watch", locale)}
    </button>
  );
}
