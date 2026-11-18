// The board filter state. Shared by the filter popover (client) and saved
// filters (stored as JSON, validated by board-filters-schema.ts on the server).
export interface Filters {
  query: string;
  assigneeId: string;
  tagId: string;
  priority: string;
  deadline: "" | "overdue" | "has" | "none";
  mine: boolean;
}

export const EMPTY_FILTERS: Filters = {
  query: "",
  assigneeId: "",
  tagId: "",
  priority: "",
  deadline: "",
  mine: false,
};

export function isFiltering(f: Filters): boolean {
  return f.query.trim() !== "" || !!f.assigneeId || !!f.tagId || !!f.priority || !!f.deadline || f.mine;
}

export function sameFilters(a: Filters, b: Filters): boolean {
  return (
    a.query.trim() === b.query.trim() &&
    a.assigneeId === b.assigneeId &&
    a.tagId === b.tagId &&
    a.priority === b.priority &&
    a.deadline === b.deadline &&
    a.mine === b.mine
  );
}
