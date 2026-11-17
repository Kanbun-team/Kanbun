"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { restoreTrashAction } from "@/server/trash-actions";
import { useUi } from "./UiProvider";

// Shows "<message> [Undo]" after a delete that moved something to the trash.
export function useUndo() {
  const { toast, report, locale } = useUi();
  const router = useRouter();
  return useCallback(
    (message: string, trashId: string) => {
      toast({
        message,
        action: {
          label: t("undo", locale),
          onAction: async () => {
            const result = report(await restoreTrashAction(trashId));
            if (result.ok) {
              toast({ message: t("restored", locale) });
              router.refresh();
            }
          },
        },
      });
    },
    [toast, report, locale, router]
  );
}
