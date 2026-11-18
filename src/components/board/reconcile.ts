import type { CardDTO, ColumnDTO } from "./types";

// Structural sharing for board data. Every router.refresh() (live updates,
// after an edit) brings a brand new copy of all columns and cards, even when
// almost nothing changed. Keeping the previous objects for unchanged cards and
// columns lets the memoized columns and cards skip re-rendering, so a refresh
// costs a few changed cards instead of the whole board.

function sameList<T extends { id: string }>(a: T[], b: T[], same: (x: T, y: T) => boolean): boolean {
  return a.length === b.length && a.every((x, i) => same(x, b[i]));
}

const samePerson = (a: CardDTO["assignees"][number], b: CardDTO["assignees"][number]) =>
  a.id === b.id && a.displayName === b.displayName && a.username === b.username && a.avatarUrl === b.avatarUrl;
const sameTag = (a: CardDTO["tags"][number], b: CardDTO["tags"][number]) =>
  a.id === b.id && a.name === b.name && a.color === b.color;

export function sameCard(a: CardDTO, b: CardDTO): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.priority === b.priority &&
    a.coverColor === b.coverColor &&
    a.deadline === b.deadline &&
    a.position === b.position &&
    a.subtasksTotal === b.subtasksTotal &&
    a.subtasksDone === b.subtasksDone &&
    a.commentsCount === b.commentsCount &&
    a.blockedByCount === b.blockedByCount &&
    a.attachmentsCount === b.attachmentsCount &&
    sameList(a.assignees, b.assignees, samePerson) &&
    sameList(a.tags, b.tags, sameTag)
  );
}

/** `next`, reusing objects from `prev` wherever they are equal. */
export function reconcileColumns(prev: ColumnDTO[], next: ColumnDTO[]): ColumnDTO[] {
  if (prev === next) return next;
  const oldCards = new Map<string, CardDTO>();
  for (const c of prev) for (const card of c.cards) oldCards.set(card.id, card);
  const oldColumns = new Map(prev.map((c) => [c.id, c]));

  let changed = prev.length !== next.length;
  const columns = next.map((col, i) => {
    const cards = col.cards.map((card) => {
      const old = oldCards.get(card.id);
      return old && sameCard(old, card) ? old : card;
    });
    const old = oldColumns.get(col.id);
    const reuse =
      old &&
      old.name === col.name &&
      old.position === col.position &&
      old.wipLimit === col.wipLimit &&
      old.cards.length === cards.length &&
      old.cards.every((card, j) => card === cards[j]);
    const result = reuse ? old : { ...col, cards };
    if (result !== prev[i]) changed = true;
    return result;
  });
  return changed ? columns : prev;
}
