// "Recently opened" boards live in a small first-party cookie instead of a
// table: the board layout moves its id to the front when the board is viewed,
// and the boards home reads the cookie on the server (so there is no hydration
// mismatch). Ids the user can no longer open are dropped by the home query.

export const RECENT_BOARDS_COOKIE = "kanbun-recent-boards";
export const RECENT_BOARDS_SHOWN = 5;
const STORED = 8;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseRecentBoards(value: string | undefined | null): string[] {
  if (!value) return [];
  const ids = value.split(".").filter((id) => ID.test(id));
  return Array.from(new Set(ids)).slice(0, STORED);
}

/** Moves `boardId` to the front of the stored list. */
export function pushRecentBoard(value: string | undefined | null, boardId: string): string {
  const ids = parseRecentBoards(value).filter((id) => id !== boardId);
  if (ID.test(boardId)) ids.unshift(boardId);
  return ids.slice(0, STORED).join(".");
}
