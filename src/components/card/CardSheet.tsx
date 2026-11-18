"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { Maximize2, X } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { iconButtonClass } from "@/components/ui/button";

// Side panel for a card opened from the board: the URL is the card's URL, but
// the board stays mounted underneath with its scroll position and filters.
// Full height sheet on phones, 640px panel from the right on larger screens.
// With `onClose` it is a plain dialog over the board (the offline card view),
// without the "open as page" link.
export default function CardSheet({
  href,
  boardHref,
  locale,
  children,
  onClose,
}: {
  href?: string;
  boardHref: string;
  locale: Locale;
  children: ReactNode;
  onClose?: () => void;
}) {
  const router = useRouter();
  function close() {
    if (onClose) return onClose();
    // Back restores the board URL (and history) when we came from it.
    if (window.history.length > 1) router.back();
    else router.push(boardHref, { scroll: false });
  }
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => !open && close()}
      className="fixed inset-0 z-[80] bg-black/30 flex justify-end"
    >
      <Modal className="h-full w-full sm:max-w-[40rem] bg-paper border-l border-line shadow-float outline-none focus-visible:outline-none flex flex-col">
        <Dialog aria-label={t("cardOpen", locale)} className="flex flex-col h-full min-h-0 outline-none focus-visible:outline-none">
          <div className="flex items-center justify-end gap-1 px-3 py-2 border-b border-line bg-surface safe-top">
            {/* A plain link (full load) so the card opens as a page, not in the panel again. */}
            {href && (
              <a href={href} className={iconButtonClass()} aria-label={t("panelOpenPage", locale)} title={t("panelOpenPage", locale)}>
                <Maximize2 size={16} aria-hidden />
              </a>
            )}
            <button type="button" onClick={close} className={iconButtonClass()} aria-label={t("close", locale)} title={t("close", locale)}>
              <X size={18} aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">{children}</div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
