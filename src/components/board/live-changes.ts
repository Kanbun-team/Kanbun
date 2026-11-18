// Soft animation for changes made by teammates (arriving over the live
// stream). Before the board re-fetches we remember where every card was; once
// the new data is on screen, cards that moved glide from their old spot (FLIP)
// and cards that are new or changed column or title get a brief accent
// outline. Cards this tab created itself are not highlighted: optimistic ones
// (temporary ids, see outbox.ts) are recognized by column and title, the rest
// are registered with markLocalCards.
//
// Only the card face (the sortable node's first child) is animated, so
// dnd-kit's own transform on the sortable node is never touched. With
// prefers-reduced-motion there is no movement, only the outline fading out.

import { TEMP_PREFIX } from "@/lib/outbox";
import type { ColumnDTO } from "./types";

type CardState = { rect: DOMRect; columnId: string; index: number; title: string };
export type CardSnapshot = Map<string, CardState>;

function cardElements(root: HTMLElement) {
  // Cards hidden by a filter are left out: they have no place on screen.
  return root.querySelectorAll<HTMLElement>("[data-card-id]:not([hidden])");
}

function positions(columns: ColumnDTO[]) {
  const map = new Map<string, { columnId: string; index: number; title: string }>();
  for (const column of columns) {
    column.cards.forEach((card, index) => map.set(card.id, { columnId: column.id, index, title: card.title }));
  }
  return map;
}

// Ids of cards created from this tab (not optimistically), so their arrival
// is not mistaken for a teammate's.
const localCards = new Set<string>();

export function markLocalCards(ids: string[]): void {
  for (const id of ids) localCards.add(id);
}

const slot = (c: { columnId: string; title: string }) => JSON.stringify([c.columnId, c.title]);

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

/** Returns the ids of cards that are new or whose column or title changed (for tests and a11y). */
export function animateChanges(
  root: HTMLElement,
  before: CardSnapshot,
  columns: ColumnDTO[],
  skipCardId: string | null
): string[] {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const now = positions(columns);
  const highlighted: string[] = [];
  // Optimistic cards of this tab, waiting for their real id.
  const pending = new Set<string>();
  for (const [id, state] of before) {
    if (id.startsWith(TEMP_PREFIX)) pending.add(slot(state));
  }
  for (const el of cardElements(root)) {
    const id = el.dataset.cardId!;
    const prev = before.get(id);
    const next = now.get(id);
    const face = el.firstElementChild as HTMLElement | null;
    if (!next || !face || typeof face.animate !== "function") continue;
    if (!prev) {
      const own = id.startsWith(TEMP_PREFIX) || localCards.delete(id) || pending.delete(slot(next));
      if (!own) highlight(el, face, id, highlighted);
      continue;
    }
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
    if (changedContent && id !== skipCardId) highlight(el, face, id, highlighted);
  }
  return highlighted;
}

function highlight(el: HTMLElement, face: HTMLElement, id: string, highlighted: string[]) {
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
