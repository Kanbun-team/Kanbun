"use client";

import { useState } from "react";
import ActionForm from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n";
import { describeRule, toRule, weekdayNames, type RuleKind } from "@/lib/recurrence";
import { createRecurrenceAction } from "@/server/template-actions";

// Form for a new "Repeat" schedule. The summary line under the fields reads
// back the rule in words ("Every Monday at 09:00") as it is edited.
export default function RecurrenceForm({
  boardId,
  templates,
  columns,
  locale,
}: {
  boardId: string;
  templates: { id: string; name: string }[];
  columns: { id: string; name: string }[];
  locale: Locale;
}) {
  const [rule, setRule] = useState<RuleKind>("weekly");
  const [weekday, setWeekday] = useState(1);
  const [monthDay, setMonthDay] = useState(1);
  const [time, setTime] = useState("");
  const names = weekdayNames(locale);
  // Monday first in the picker.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const parsed = toRule({ rule, weekday, monthDay, timeOfDay: time || null });
  const label = "text-sm text-ink-muted";

  return (
    <ActionForm action={createRecurrenceAction} success={t("repeatCreated", locale)} className="space-y-3 pt-1">
      <input type="hidden" name="boardId" value={boardId} />
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className={label}>{t("repeatTemplate", locale)}</span>
          <select name="templateId" required defaultValue={templates[0]?.id}>
            {templates.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className={label}>{t("repeatColumn", locale)}</span>
          <select name="columnId" required defaultValue={columns[0]?.id}>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className={label}>{t("repeatEvery", locale)}</span>
          <select name="rule" value={rule} onChange={(e) => setRule(e.target.value as RuleKind)}>
            <option value="daily">{t("repeatDaily", locale)}</option>
            <option value="weekly">{t("repeatWeekly", locale)}</option>
            <option value="monthly">{t("repeatMonthly", locale)}</option>
          </select>
        </label>
        {rule === "weekly" && (
          <label className="block space-y-1">
            <span className={label}>{t("repeatWeekday", locale)}</span>
            <select name="weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {order.map((d) => (
                <option key={d} value={d}>
                  {names[d]}
                </option>
              ))}
            </select>
          </label>
        )}
        {rule === "monthly" && (
          <label className="block space-y-1">
            <span className={label}>{t("repeatMonthDay", locale)}</span>
            <select name="monthDay" value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block space-y-1">
          <span className={label}>{t("repeatTime", locale)}</span>
          <input type="time" name="timeOfDay" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      {parsed && (
        <p className="text-sm" aria-live="polite">
          <span className="text-ink-muted">{t("repeatSummary", locale)} </span>
          <span className="font-medium">{describeRule(parsed, locale)}</span>
          {rule === "monthly" && monthDay > 28 && (
            <span className="block text-xs text-ink-muted">{t("repeatMonthEndHint", locale)}</span>
          )}
        </p>
      )}
      <button className={buttonClass("primary")}>{t("repeatCreate", locale)}</button>
    </ActionForm>
  );
}
