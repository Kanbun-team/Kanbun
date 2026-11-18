"use client";

import { useFormStatus } from "react-dom";
import BoardTemplatePicker from "@/components/BoardTemplatePicker";
import { useUi } from "@/components/ui/UiProvider";
import { buttonClass } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n";
import { createBoardAction } from "@/server/tasks-actions";

function SubmitButton({ locale }: { locale: Locale }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary", "lg", "w-full disabled:opacity-60")}>
      {t("setupBoardCreate", locale)}
    </button>
  );
}

export default function FirstBoardForm({ locale }: { locale: Locale }) {
  const { report } = useUi();
  return (
    <form
      action={async (fd) => {
        // Redirects to the new board on success.
        report(await createBoardAction(fd));
      }}
      className="space-y-4"
    >
      <label className="block">
        <span className="text-sm font-medium text-ink-muted">{t("boardName", locale)}</span>
        <input name="name" required maxLength={120} defaultValue={t("setupBoardDefaultName", locale)} className="mt-1.5" />
      </label>
      <BoardTemplatePicker locale={locale} />
      <SubmitButton locale={locale} />
    </form>
  );
}
