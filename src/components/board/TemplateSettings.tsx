import ActionForm from "@/components/ui/ActionForm";
import { buttonClass } from "@/components/ui/button";
import TagChip from "@/components/ui/TagChip";
import { formatDateTime, t, type Locale } from "@/lib/i18n";
import { PRIORITIES, priorityLabel } from "@/lib/labels";
import { parseStringArray } from "@/lib/card-templates";
import { describeRule, toRule } from "@/lib/recurrence";
import {
  createCardTemplateAction,
  deleteCardTemplateAction,
  deleteRecurrenceAction,
  setRecurrenceActiveAction,
  updateCardTemplateAction,
} from "@/server/template-actions";
import RecurrenceForm from "./RecurrenceForm";

// Board settings: card templates and the "Repeat" schedules built on them.
// Server component; only the schedule form needs client state.

export interface TemplateRow {
  id: string;
  name: string;
  title: string;
  description: string | null;
  priority: string;
  tagIds: string;
  checklist: string;
}

export interface RecurrenceRow {
  id: string;
  rule: string;
  weekday: number | null;
  monthDay: number | null;
  timeOfDay: string | null;
  nextRunAt: Date;
  active: boolean;
  template: { name: string } | null;
  column: { name: string } | null;
}

type Tag = { id: string; name: string; color: string };

const card = "bg-surface border border-line rounded-panel p-4";
const label = "text-sm text-ink-muted";

function TemplateFields({ template, tags, locale, idPrefix }: { template?: TemplateRow; tags: Tag[]; locale: Locale; idPrefix: string }) {
  const selected = new Set(parseStringArray(template?.tagIds));
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className={label}>{t("templateName", locale)}</span>
          <input name="name" required maxLength={80} defaultValue={template?.name} />
        </label>
        <label className="block space-y-1">
          <span className={label}>{t("templateCardTitle", locale)}</span>
          <input name="title" required maxLength={200} defaultValue={template?.title} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className={label}>{t("cardDescription", locale)}</span>
        <textarea name="description" rows={3} maxLength={20_000} defaultValue={template?.description ?? ""} />
      </label>
      <label className="block space-y-1">
        <span className={label}>{t("cardPriority", locale)}</span>
        <select name="priority" defaultValue={template?.priority ?? "normal"}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {priorityLabel(p, locale)}
            </option>
          ))}
        </select>
      </label>
      {tags.length > 0 && (
        <fieldset className="space-y-1">
          <legend className={label}>{t("cardTags", locale)}</legend>
          <div className="flex flex-wrap gap-2 pt-1">
            {tags.map((tag) => (
              <label key={tag.id} htmlFor={`${idPrefix}-tag-${tag.id}`} className="inline-flex items-center gap-1.5 min-h-6 cursor-pointer">
                <input
                  id={`${idPrefix}-tag-${tag.id}`}
                  type="checkbox"
                  name="tagIds"
                  value={tag.id}
                  defaultChecked={selected.has(tag.id)}
                />
                <TagChip name={tag.name} color={tag.color} />
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="space-y-1">
        <label className="block space-y-1">
          <span className={label}>{t("templateChecklist", locale)}</span>
          <textarea
            name="checklist"
            rows={3}
            defaultValue={parseStringArray(template?.checklist).join("\n")}
            aria-describedby={`${idPrefix}-checklist-hint`}
          />
        </label>
        <p id={`${idPrefix}-checklist-hint`} className="text-xs text-ink-muted">
          {t("templateChecklistHint", locale)}
        </p>
      </div>
    </>
  );
}

export default function TemplateSettings({
  boardId,
  templates,
  recurrences,
  columns,
  tags,
  locale,
}: {
  boardId: string;
  templates: TemplateRow[];
  recurrences: RecurrenceRow[];
  columns: { id: string; name: string }[];
  tags: Tag[];
  locale: Locale;
}) {
  return (
    <>
      <section className={`${card} space-y-3`} aria-labelledby="settings-templates">
        <div>
          <h2 id="settings-templates" className="text-md font-semibold">
            {t("templatesTitle", locale)}
          </h2>
          <p className="text-sm text-ink-muted">{t("templatesIntro", locale)}</p>
        </div>
        {templates.length === 0 ? (
          <p className="text-ink-muted">{t("templatesEmpty", locale)}</p>
        ) : (
          <ul className="divide-y divide-line border border-line rounded-card">
            {templates.map((tp) => {
              const items = parseStringArray(tp.checklist).length;
              return (
                <li key={tp.id}>
                  <details className="group">
                    <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer min-h-10">
                      <span className="font-medium truncate">{tp.name}</span>
                      <span className="text-sm text-ink-muted truncate flex-1">
                        {tp.title}
                        {items > 0 && `, ${t("templateChecklistCount", locale).replace("{count}", String(items))}`}
                      </span>
                      <span className="text-sm text-accent group-open:hidden">{t("edit", locale)}</span>
                    </summary>
                    <div className="px-3 pb-3 space-y-3">
                      <ActionForm action={updateCardTemplateAction} success={t("savedToast", locale)} className="space-y-3">
                        <input type="hidden" name="templateId" value={tp.id} />
                        <TemplateFields template={tp} tags={tags} locale={locale} idPrefix={`tpl-${tp.id}`} />
                        <button className={buttonClass("primary")}>{t("save", locale)}</button>
                      </ActionForm>
                      <ActionForm
                        action={deleteCardTemplateAction}
                        success={t("templateDeleted", locale)}
                        confirm={{
                          title: t("confirmDeleteTemplate", locale).replace("{name}", tp.name),
                          body: t("confirmDeleteTemplateBody", locale),
                          confirmLabel: t("delete", locale),
                          danger: true,
                        }}
                      >
                        <input type="hidden" name="templateId" value={tp.id} />
                        <button className={buttonClass("ghost", "sm", "text-danger hover:text-danger")}>
                          {t("templateDelete", locale)}
                        </button>
                      </ActionForm>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        <details className="border border-line rounded-card">
          <summary className="px-3 py-2 cursor-pointer font-medium min-h-10 flex items-center">{t("templateNew", locale)}</summary>
          <ActionForm
            action={createCardTemplateAction}
            resetOnSuccess
            success={t("templateCreated", locale)}
            className="px-3 pb-3 space-y-3"
          >
            <input type="hidden" name="boardId" value={boardId} />
            <TemplateFields tags={tags} locale={locale} idPrefix="tpl-new" />
            <button className={buttonClass("primary")}>{t("templateCreate", locale)}</button>
          </ActionForm>
        </details>
      </section>

      <section className={`${card} space-y-3`} aria-labelledby="settings-repeat">
        <div>
          <h2 id="settings-repeat" className="text-md font-semibold">
            {t("repeatTitle", locale)}
          </h2>
          <p className="text-sm text-ink-muted">{t("repeatIntro", locale)}</p>
        </div>
        {recurrences.length > 0 && (
          <ul className="divide-y divide-line border border-line rounded-card">
            {recurrences.map((r) => {
              const rule = toRule(r);
              const broken = !r.template || !r.column;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">
                      {rule ? describeRule(rule, locale) : r.rule}
                      {!r.active && <span className="ml-2 text-sm font-normal text-ink-muted">({t("repeatPaused", locale)})</span>}
                    </div>
                    <div className="text-sm text-ink-muted">
                      {broken
                        ? t("repeatBroken", locale)
                        : t("repeatCreates", locale)
                            .replace("{template}", r.template!.name)
                            .replace("{column}", r.column!.name)}
                    </div>
                    {r.active && (
                      <div className="text-xs text-ink-muted">
                        {t("repeatNextRun", locale).replace("{date}", formatDateTime(r.nextRunAt, locale))}
                      </div>
                    )}
                  </div>
                  {!broken && (
                    <ActionForm action={setRecurrenceActiveAction}>
                      <input type="hidden" name="recurrenceId" value={r.id} />
                      <input type="hidden" name="active" value={String(!r.active)} />
                      <button className={buttonClass("secondary", "sm")}>
                        {r.active ? t("repeatPause", locale) : t("repeatResume", locale)}
                      </button>
                    </ActionForm>
                  )}
                  <ActionForm
                    action={deleteRecurrenceAction}
                    confirm={{
                      title: t("confirmDeleteRepeat", locale),
                      confirmLabel: t("delete", locale),
                      danger: true,
                    }}
                  >
                    <input type="hidden" name="recurrenceId" value={r.id} />
                    <button className={buttonClass("ghost", "sm", "text-danger hover:text-danger")}>{t("delete", locale)}</button>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
        {templates.length === 0 || columns.length === 0 ? (
          <p className="text-ink-muted">{t("repeatNeedsTemplate", locale)}</p>
        ) : (
          <RecurrenceForm
            boardId={boardId}
            templates={templates.map((tp) => ({ id: tp.id, name: tp.name }))}
            columns={columns}
            locale={locale}
          />
        )}
      </section>
    </>
  );
}
