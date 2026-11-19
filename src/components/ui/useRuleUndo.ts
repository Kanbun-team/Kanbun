"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { t, tn } from "@/lib/i18n";
import type { RuleRunNotice } from "@/lib/automations";
import { undoAutomationRunAction } from "@/server/automation-actions";
import { useUi } from "./UiProvider";

/**
 * After an action of the user set off automation rules: shows
 * "Rule "Done cleanup" updated the card [Undo]". Undo reverts the rules'
 * changes (newest first), not the action itself. Returns false when no rule
 * changed anything, so the caller can show its usual toast instead.
 */
export function useRuleUndo() {
  const { toast, report, locale } = useUi();
  const router = useRouter();
  return useCallback(
    (notices: RuleRunNotice[] | undefined): boolean => {
      if (!notices?.length) return false;
      const message =
        notices.length === 1
          ? t("automationAppliedToast", locale).replace("{name}", notices[0].ruleName)
          : tn("automationsAppliedToast", notices.length, locale);
      toast({
        message,
        action: {
          label: t("undo", locale),
          onAction: async () => {
            for (const n of [...notices].reverse()) {
              if (!report(await undoAutomationRunAction(n.runId)).ok) break;
            }
            toast({ message: t("automationUndoneToast", locale) });
            router.refresh();
          },
        },
      });
      return true;
    },
    [toast, report, locale, router]
  );
}
