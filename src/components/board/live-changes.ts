// Soft animation for changes made by teammates (arriving over the live
// stream). Before the board re-fetches we remember where every card was; once
// the new data is on screen, cards that moved glide from their old spot (FLIP)
// and cards that changed column or title get a brief accent outline.
//
// Only the card face (the sortable node's first child) is animated, so
// dnd-kit's own transform on the sortable node is never touched. With
// prefers-reduced-motion there is no movement, only the outline fading out.

import type { ColumnDTO } from "./types";

type CardState = { rect: DOMRect; columnId: string; index: number; title: string };
export type CardSnapshot = Map<string, CardState>;

function cardElements(root: HTMLElement) {
  return root.querySelectorAll<HTMLElement>("[data-card-id]");
}

function positions(columns: ColumnDTO[]) {
  const map = new Map<string, { columnId: string; index: number; title: string }>();
  for (const column of columns) {
    column.cards.forEach((card, index) => map.set(card.id, { columnId: column.id, index, title: card.title }));
  }
  return map;
}

export function snapshotCards(root: HTMLElement, columns: ColumnDTO[]): CardSnapshot {
  const data = positions(columns);
  const snapshot: CardSnapshot = new Map();
  for (const el of cardElements(root)) {
    const id = el.dataset.cardId!;
    const d = data.get(id);
    if (d) snapshot.set(id, { rect: el.getBoundingClientRect(), ...d });
  }
  return snapshot;
}

/** Returns the ids of cards whose column or title changed (for tests and a11y). */
export function animateChanges(
  root: HTMLElement,
  before: CardSnapshot,
  columns: ColumnDTO[],
  skipCardId: string | null
): string[] {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const now = positions(columns);
  const highlighted: string[] = [];
  for (const el of cardElements(root)) {
    const id = el.dataset.cardId!;
    const prev = before.get(id);
    const next = now.get(id);
    const face = el.firstElementChild as HTMLElement | null;
    if (!prev || !next || !face || typeof face.animate !== "function") continue;
    const changedPlace = prev.columnId !== next.columnId || prev.index !== next.index;
    const changedContent = prev.columnId !== next.columnId || prev.title !== next.title;

    if (changedPlace && !reduce) {
      const rect = el.getBoundingClientRect();
      const dx = prev.rect.left - rect.left;
      const dy = prev.rect.top - rect.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        face.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
          { duration: 260, easing: "cubic-bezier(0.2, 0, 0, 1)" }
        );
      }
    }
    if (changedContent && id !== skipCardId) {
      highlighted.push(id);
      el.dataset.liveChanged = "";
      const anim = face.animate(
        [
          { outline: "2px solid rgb(var(--accent) / 0.9)", outlineOffset: "1px" },
          { outline: "2px solid rgb(var(--accent) / 0)", outlineOffset: "1px" },
        ],
        { duration: 1600, easing: "ease-out" }
      );
      anim.onfinish = () => delete el.dataset.liveChanged;
    }
  }
  return highlighted;
}
