"use client";

import { useEffect } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import StatusPage from "@/components/StatusPage";
import { useUi } from "@/components/ui/UiProvider";
import { buttonClass } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { locale } = useUi();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <StatusPage title={t("errorTitle", locale)} body={t("errorBody", locale)}>
      <button type="button" className={buttonClass("primary")} onClick={reset}>
        {t("tryAgain", locale)}
      </button>
      <Link href="/tasks" className={buttonClass("secondary")}>
        {t("backToBoards", locale)}
      </Link>
    </StatusPage>
  );
}
