"use client";

import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { X } from "lucide-react";
import { t, type DictKey, type Locale } from "@/lib/i18n";
import { buttonClass, iconButtonClass } from "@/components/ui/button";
import type { CardDTO, ColumnDTO } from "./types";

function DialogShell({
  open,
  onClose,
  title,
  locale,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(o) => !o && onClose()}
      isDismissable
      className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4"
    >
      <Modal className="w-full max-w-md rounded-panel bg-raised text-ink shadow-float border border-line">
        <Dialog className="p-5 outline-none">
          <div className="flex items-start justify-between gap-3">
            <Heading slot="title" className="text-lg font-semibold break-words min-w-0">
              {title}
            </Heading>
            <button type="button" className={iconButtonClass("-mr-2 -mt-1")} aria-label={t("close", locale)} onClick={onClose}>
              <X size={16} aria-hidden />
            </button>
          </div>
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

// "Move to": the non-drag way to move a card (WCAG 2.5.7).
export function MoveCardDialog({
  card,
  columns,
  locale,
  onClose,
  onMove,
}: {
  card: CardDTO | null;
  columns: ColumnDTO[];
  locale: Locale;
  onClose: () => void;
  onMove: (card: CardDTO, columnId: string, position: number) => void;
}) {
  const current = card ? columns.find((c) => c.cards.some((x) => x.id === card.id)) : undefined;
  return (
    <DialogShell
      open={card !== null}
      onClose={onClose}
      locale={locale}
      title={card ? t("moveTitle", locale).replace("{title}", card.title) : ""}
    >
      {card && (
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const columnId = String(fd.get("columnId"));
            const target = columns.find((c) => c.id === columnId);
            if (!target) return;
            const others = target.cards.filter((c) => c.id !== card.id).length;
            onMove(card, columnId, fd.get("position") === "top" ? 0 : others);
            onClose();
          }}
        >
          <label className="block space-y-1">
            <span className="text-sm font-medium text-ink-muted">{t("moveColumn", locale)}</span>
            <select name="columnId" defaultValue={current?.id} autoFocus>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.cards.length})
                </option>
              ))}
            </select>
          </label>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium text-ink-muted">{t("movePosition", locale)}</legend>
            <div className="flex gap-4">
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="position" value="top" />
                {t("moveTop", locale)}
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="position" value="bottom" defaultChecked />
                {t("moveBottom", locale)}
              </label>
            </div>
          </fieldset>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass("secondary")} onClick={onClose}>
              {t("cancel", locale)}
            </button>
            <button className={buttonClass("primary")}>{t("moveSubmit", locale)}</button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

const SHORTCUTS: [string[], DictKey][] = [
  [["Ctrl", "K"], "shortcutPalette"],
  [["→"], "shortcutPaletteCard"],
  [["/"], "shortcutSearch"],
  [["N"], "shortcutNew"],
  [["E"], "shortcutEdit"],
  [["A"], "shortcutAssign"],
  [["D"], "shortcutDeadline"],
  [["Enter"], "shortcutOpen"],
  [["Space"], "shortcutLift"],
  [["Shift", "↑", "↓"], "shortcutLaneMove"],
  [["J", "K", "H", "L"], "shortcutNavigate"],
  [["Esc"], "shortcutClose"],
  [["?"], "shortcutHelp"],
];

export function ShortcutsDialog({ open, locale, onClose }: { open: boolean; locale: Locale; onClose: () => void }) {
  return (
    <DialogShell open={open} onClose={onClose} locale={locale} title={t("shortcutsTitle", locale)}>
      <dl className="mt-4 divide-y divide-line">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2">
            <dt className="text-base">{t(label, locale)}</dt>
            <dd className="flex gap-1 shrink-0">
              {keys.map((k) => (
                <kbd key={k} className="min-w-6 text-center text-sm border border-line-strong border-b-2 rounded-control px-1.5 bg-surface">
                  {k}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </DialogShell>
  );
}
