export interface MemberOption {
  id: string;
  displayName: string | null;
  username: string;
  avatarUrl: string | null;
}

export interface TagOption {
  id: string;
  name: string;
  color: string;
}

export interface CardDTO {
  id: string;
  title: string;
  priority: string;
  coverColor: string | null;
  deadline: string | null;
  position: number;
  assignees: MemberOption[];
  tags: TagOption[];
  subtasksTotal: number;
  subtasksDone: number;
  commentsCount: number;
  blockedByCount: number;
}

export interface ColumnDTO {
  id: string;
  name: string;
  position: number;
  wipLimit: number | null;
  cards: CardDTO[];
}

export type CardPatch = Partial<Pick<CardDTO, "title" | "priority" | "coverColor" | "deadline" | "assignees" | "tags">>;

export interface SavedFilterDTO {
  id: string;
  name: string;
  filters: import("@/lib/board-filters").Filters;
  /** The creator and board managers can delete it. */
  canDelete: boolean;
}

export const columnKey = (id: string) => `col:${id}`;
export const isColumnKey = (id: string) => id.startsWith("col:");
export const columnIdOf = (key: string) => key.slice(4);
