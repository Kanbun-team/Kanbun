import { t, type Locale } from "@/lib/i18n";
import { BOARD_TEMPLATE_IDS, BOARD_TEMPLATES, boardTemplateContent, type BoardTemplateId } from "@/lib/board-templates";

// Radio cards for the built-in board templates (form field "template").
// Plain HTML, so it works in both server and client components.
export default function BoardTemplatePicker({
  locale,
  defaultValue = "simple",
}: {
  locale: Locale;
  defaultValue?: BoardTemplateId;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink-muted mb-1.5">{t("boardTemplate", locale)}</legend>
      <div className="grid sm:grid-cols-2 gap-2">
        {BOARD_TEMPLATE_IDS.map((id) => {
          const tpl = BOARD_TEMPLATES[id];
          const { columns } = boardTemplateContent(id, locale);
          return (
            <label
              key={id}
              className="relative flex gap-2.5 items-start rounded-card border border-line bg-surface p-3 cursor-pointer hover:border-line-strong has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"
            >
              <input type="radio" name="template" value={id} defaultChecked={id === defaultValue} className="mt-1" />
              <span className="min-w-0">
                <span className="block font-medium">{t(tpl.label, locale)}</span>
                <span className="block text-sm text-ink-muted">
                  {columns.length ? columns.join(" / ") : t(tpl.description, locale)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
