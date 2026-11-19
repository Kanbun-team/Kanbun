"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, Heading, Label, Modal, ModalOverlay, Radio, RadioGroup, Switch } from "react-aria-components";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useUi } from "@/components/ui/UiProvider";
import { blockedOffline } from "@/components/ui/offline";
import { buttonClass, iconButtonClass } from "@/components/ui/button";
import { t, type DictKey, type Locale } from "@/lib/i18n";
import { PRIORITIES, priorityLabel } from "@/lib/labels";
import {
  ACTIONS_FOR_TRIGGER,
  MAX_ACTIONS_PER_RULE,
  MAX_DEADLINE_DAYS,
  describeRule,
  type AutomationAction,
  type AutomationActionType,
  type AutomationTrigger,
  type RuleNames,
} from "@/lib/automations";
import {
  createAutomationRuleAction,
  deleteAutomationRuleAction,
  setAutomationRuleEnabledAction,
  updateAutomationRuleAction,
} from "@/server/automation-actions";

// Board settings: automation rules ("When a card enters Done: mark the
// checklist done"). Listed in plain language; added and edited in a dialog.

export interface AutomationRow {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  columnId: string | null;
  actions: AutomationAction[];
  enabled: boolean;
}

type Named = { id: string; name: string };

const OPTION_LABEL: Record<AutomationActionType, DictKey> = {
  assign: "automationOptAssign",
  unassignAll: "automationOptUnassignAll",
  addTag: "automationOptAddTag",
  removeTag: "automationOptRemoveTag",
  setPriority: "automationOptPriority",
  setDeadline: "automationOptDeadline",
  clearDeadline: "automationOptClearDeadline",
  completeChecklist: "automationOptChecklist",
  moveToColumn: "automationOptMove",
};

/** One action row in the form: every field, whichever type is picked. */
interface DraftAction {
  key: number;
  type: AutomationActionType;
  userIds: string[];
  tagId: string;
  priority: string;
  days: number;
  columnId: string;
}

interface Draft {
  name: string;
  trigger: AutomationTrigger;
  columnId: string;
  actions: DraftAction[];
}

let nextKey = 1;

function draftAction(type: AutomationActionType, defaults: { tagId: string; columnId: string }, from?: AutomationAction): DraftAction {
  return {
    key: nextKey++,
    type,
    userIds: from?.type === "assign" ? from.userIds : [],
    tagId: from?.type === "addTag" || from?.type === "removeTag" ? from.tagId : defaults.tagId,
    priority: from?.type === "setPriority" ? from.priority : "high",
    days: from?.type === "setDeadline" ? from.days : 3,
    columnId: from?.type === "moveToColumn" ? from.columnId : defaults.columnId,
  };
}

function toAction(d: DraftAction): AutomationAction {
  switch (d.type) {
    case "assign":
      return { type: "assign", userIds: d.userIds };
    case "addTag":
    case "removeTag":
      return { type: d.type, tagId: d.tagId };
    case "setPriority":
      return { type: "setPriority", priority: d.priority as (typeof PRIORITIES)[number] };
    case "setDeadline":
      return { type: "setDeadline", days: d.days };
    case "moveToColumn":
      return { type: "moveToColumn", columnId: d.columnId };
    default:
      return { type: d.type };
  }
}

export default function AutomationSettings({
  boardId,
  rules,
  columns,
  tags,
  members,
  locale,
}: {
  boardId: string;
  rules: AutomationRow[];
  columns: Named[];
  tags: Named[];
  /** Active board members, the people a rule can assign. */
  members: Named[];
  locale: Locale;
}) {
  const ui = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // null: closed; "new": adding; otherwise the rule being edited.
  const [editing, setEditing] = useState<AutomationRow | "new" | null>(null);
  const names: RuleNames = {
    columns: new Map(columns.map((c) => [c.id, c.name])),
    tags: new Map(tags.map((tg) => [tg.id, tg.name])),
    users: new Map(members.map((m) => [m.id, m.name])),
  };

  function toggle(rule: AutomationRow, on: boolean) {
    if (blockedOffline(ui)) return;
    startTransition(async () => {
      if (ui.report(await setAutomationRuleEnabledAction(rule.id, on)).ok) router.refresh();
    });
  }

  async function remove(rule: AutomationRow) {
    if (blockedOffline(ui)) return;
    const ok = await ui.confirm({
      title: t("confirmDeleteAutomation", locale).replace("{name}", rule.name),
      body: t("confirmDeleteAutomationBody", locale),
      confirmLabel: t("delete", locale),
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      if (!ui.report(await deleteAutomationRuleAction(rule.id)).ok) return;
      ui.toast({ message: t("automationDeleted", locale) });
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="automations-title" className="bg-surface border border-line rounded-panel p-4 space-y-4">
      <div className="space-y-1">
        <h2 id="automations-title" className="text-md font-semibold">
          {t("automationsTitle", locale)}
        </h2>
        <p className="text-sm text-ink-muted max-w-prose">{t("automationsHint", locale)}</p>
      </div>

      {rules.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("automationNone", locale)}</p>
      ) : (
        <ul className="space-y-2" aria-label={t("automationsTitle", locale)} aria-busy={pending || undefined}>
          {rules.map((rule) => (
            <li key={rule.id} className="rounded-control border border-line p-3 flex flex-wrap items-start gap-x-3 gap-y-2">
              <div className="flex-1 min-w-[12rem] space-y-0.5">
                <p id={`rule-${rule.id}-name`} className={rule.enabled ? "font-medium break-words" : "font-medium break-words text-ink-muted"}>
                  {rule.name}
                </p>
                <p className="text-sm text-ink-muted break-words">{describeRule(rule, names, locale)}</p>
              </div>
              <div className="flex items-center gap-1">
                <Switch
                  isSelected={rule.enabled}
                  onChange={(on) => toggle(rule, on)}
                  isDisabled={pending}
                  aria-describedby={`rule-${rule.id}-name`}
                  className="group inline-flex items-center gap-2 min-h-8 px-1 text-sm cursor-pointer"
                >
                  <span
                    aria-hidden
                    className="relative w-8 h-5 rounded-full border border-ink-muted bg-surface transition-colors duration-[120ms] motion-reduce:transition-none group-data-[selected]:bg-accent group-data-[selected]:border-accent group-data-[focus-visible]:outline group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-accent"
                  >
                    <span className="absolute top-[3px] left-[3px] w-3 h-3 rounded-full bg-ink-muted transition-transform duration-[120ms] motion-reduce:transition-none group-data-[selected]:translate-x-3 group-data-[selected]:bg-accent-fg" />
                  </span>
                  {t("automationEnabled", locale)}
                </Switch>
                <button
                  type="button"
                  className={iconButtonClass()}
                  aria-label={t("automationEditNamed", locale).replace("{name}", rule.name)}
                  onClick={() => setEditing(rule)}
                >
                  <Pencil size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className={iconButtonClass("hover:text-danger")}
                  aria-label={t("automationDeleteNamed", locale).replace("{name}", rule.name)}
                  onClick={() => remove(rule)}
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className={buttonClass("primary")} onClick={() => setEditing("new")}>
        <Plus size={16} aria-hidden />
        {t("automationAdd", locale)}
      </button>

      <ModalOverlay
        isOpen={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        isDismissable
        className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4"
      >
        <Modal className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-panel bg-raised text-ink shadow-float border border-line">
          <Dialog className="p-5 outline-none">
            {editing !== null && (
              <RuleForm
                key={editing === "new" ? "new" : editing.id}
                boardId={boardId}
                rule={editing === "new" ? null : editing}
                columns={columns}
                tags={tags}
                members={members}
                locale={locale}
                onDone={() => setEditing(null)}
              />
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </section>
  );
}

function RuleForm({
  boardId,
  rule,
  columns,
  tags,
  members,
  locale,
  onDone,
}: {
  boardId: string;
  rule: AutomationRow | null;
  columns: Named[];
  tags: Named[];
  members: Named[];
  locale: Locale;
  onDone: () => void;
}) {
  const ui = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const defaults = { tagId: tags[0]?.id ?? "", columnId: columns.at(-1)?.id ?? "" };
  const [draft, setDraft] = useState<Draft>(() =>
    rule
      ? {
          name: rule.name,
          trigger: rule.trigger,
          columnId: rule.columnId ?? defaults.columnId,
          actions: rule.actions.map((a) => draftAction(a.type, defaults, a)),
        }
      : { name: "", trigger: "cardEntersColumn", columnId: defaults.columnId, actions: [draftAction("completeChecklist", defaults)] }
  );
  const allowed = ACTIONS_FOR_TRIGGER[draft.trigger];
  const label = "text-sm text-ink-muted";

  function setTrigger(trigger: AutomationTrigger) {
    const keep = draft.actions.filter((a) => ACTIONS_FOR_TRIGGER[trigger].includes(a.type));
    setDraft({ ...draft, trigger, actions: keep.length ? keep : [draftAction(ACTIONS_FOR_TRIGGER[trigger][0], defaults)] });
  }

  function patchAction(key: number, patch: Partial<DraftAction>) {
    setDraft({ ...draft, actions: draft.actions.map((a) => (a.key === key ? { ...a, ...patch } : a)) });
  }

  function submit() {
    if (blockedOffline(ui)) return;
    const input = {
      name: draft.name,
      trigger: draft.trigger,
      columnId: draft.trigger === "cardEntersColumn" ? draft.columnId : null,
      actions: draft.actions.map(toAction),
      enabled: rule?.enabled ?? true,
    };
    startTransition(async () => {
      const result = rule
        ? ui.report(await updateAutomationRuleAction(rule.id, input))
        : ui.report(await createAutomationRuleAction(boardId, input));
      if (!result.ok) return;
      ui.toast({ message: t(rule ? "automationSaved" : "automationAdded", locale) });
      onDone();
      router.refresh();
    });
  }

  return (
    <form
      className="space-y-4"
      aria-busy={pending || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <Heading slot="title" className="text-lg font-semibold">
          {t(rule ? "automationEdit" : "automationAdd", locale)}
        </Heading>
        <button type="button" className={iconButtonClass("-mr-2 -mt-1")} aria-label={t("close", locale)} onClick={onDone}>
          <X size={16} aria-hidden />
        </button>
      </div>

      <label className="block space-y-1">
        <span className={label}>{t("automationName", locale)}</span>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          required
          maxLength={80}
          autoFocus
        />
      </label>

      <RadioGroup
        value={draft.trigger}
        onChange={(v) => setTrigger(v as AutomationTrigger)}
        className="space-y-1"
      >
        <Label className={label}>{t("automationTrigger", locale)}</Label>
        {(["cardEntersColumn", "deadlinePassed"] as const).map((trigger) => (
          <Radio
            key={trigger}
            value={trigger}
            className="group flex items-center gap-2 min-h-8 cursor-pointer text-base"
          >
            <span
              aria-hidden
              className="w-4 h-4 rounded-full border border-ink-muted grid place-items-center group-data-[selected]:border-accent group-data-[focus-visible]:outline group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-accent"
            >
              <span className="w-2 h-2 rounded-full bg-accent hidden group-data-[selected]:block" />
            </span>
            {t(trigger === "cardEntersColumn" ? "automationTriggerEnters" : "automationTriggerDeadline", locale)}
          </Radio>
        ))}
      </RadioGroup>

      {draft.trigger === "cardEntersColumn" ? (
        <label className="block space-y-1">
          <span className={label}>{t("automationColumn", locale)}</span>
          <select value={draft.columnId} onChange={(e) => setDraft({ ...draft, columnId: e.target.value })} required>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm text-ink-muted max-w-prose">{t("automationDeadlineHint", locale)}</p>
      )}

      <fieldset className="space-y-3">
        <legend className={`${label} mb-1`}>{t("automationActions", locale)}</legend>
        {draft.actions.map((a, index) => {
          const number = String(index + 1);
          return (
            <div key={a.key} className="rounded-control border border-line p-3 space-y-2">
              <div className="flex items-end gap-2">
                <label className="block space-y-1 flex-1 min-w-0">
                  <span className={label}>
                    {t("automationActionNumber", locale).replace("{number}", number)}
                  </span>
                  <select
                    value={a.type}
                    onChange={(e) => patchAction(a.key, { type: e.target.value as AutomationActionType })}
                  >
                    {allowed.map((type) => (
                      <option key={type} value={type}>
                        {t(OPTION_LABEL[type], locale)}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.actions.length > 1 && (
                  <button
                    type="button"
                    className={iconButtonClass("shrink-0")}
                    aria-label={t("automationRemoveAction", locale).replace("{number}", number)}
                    onClick={() => setDraft({ ...draft, actions: draft.actions.filter((x) => x.key !== a.key) })}
                  >
                    <X size={16} aria-hidden />
                  </button>
                )}
              </div>
              <ActionParams action={a} columns={columns} tags={tags} members={members} locale={locale} onChange={(p) => patchAction(a.key, p)} />
            </div>
          );
        })}
        {draft.actions.length < MAX_ACTIONS_PER_RULE && (
          <button
            type="button"
            className={buttonClass("secondary", "sm")}
            onClick={() => setDraft({ ...draft, actions: [...draft.actions, draftAction(allowed[0], defaults)] })}
          >
            <Plus size={14} aria-hidden />
            {t("automationAddAction", locale)}
          </button>
        )}
      </fieldset>

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <button type="button" className={buttonClass("secondary")} onClick={onDone}>
          {t("cancel", locale)}
        </button>
        <button className={buttonClass("primary")} disabled={pending}>
          {t("save", locale)}
        </button>
      </div>
    </form>
  );
}

function ActionParams({
  action: a,
  columns,
  tags,
  members,
  locale,
  onChange,
}: {
  action: DraftAction;
  columns: Named[];
  tags: Named[];
  members: Named[];
  locale: Locale;
  onChange: (patch: Partial<DraftAction>) => void;
}) {
  const label = "text-sm text-ink-muted";
  switch (a.type) {
    case "assign":
      return (
        <fieldset>
          <legend className={label}>{t("automationPeople", locale)}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            {members.map((m) => (
              <label key={m.id} className="inline-flex items-center gap-1.5 min-h-6 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={a.userIds.includes(m.id)}
                  onChange={(e) =>
                    onChange({ userIds: e.target.checked ? [...a.userIds, m.id] : a.userIds.filter((u) => u !== m.id) })
                  }
                />
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>
      );
    case "addTag":
    case "removeTag":
      return tags.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("automationNoTags", locale)}</p>
      ) : (
        <label className="block space-y-1">
          <span className={label}>{t("automationTag", locale)}</span>
          <select value={a.tagId} onChange={(e) => onChange({ tagId: e.target.value })} required>
            {tags.map((tg) => (
              <option key={tg.id} value={tg.id}>
                {tg.name}
              </option>
            ))}
          </select>
        </label>
      );
    case "setPriority":
      return (
        <label className="block space-y-1">
          <span className={label}>{t("cardPriority", locale)}</span>
          <select value={a.priority} onChange={(e) => onChange({ priority: e.target.value })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityLabel(p, locale)}
              </option>
            ))}
          </select>
        </label>
      );
    case "setDeadline":
      return (
        <label className="block space-y-1">
          <span className={label}>{t("automationDays", locale)}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_DEADLINE_DAYS}
            required
            value={a.days}
            onChange={(e) => onChange({ days: Math.max(0, Math.min(MAX_DEADLINE_DAYS, Math.trunc(Number(e.target.value) || 0))) })}
            className="max-w-[8rem]"
          />
        </label>
      );
    case "moveToColumn":
      return (
        <label className="block space-y-1">
          <span className={label}>{t("automationColumn", locale)}</span>
          <select value={a.columnId} onChange={(e) => onChange({ columnId: e.target.value })} required>
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      );
    default:
      return null;
  }
}
