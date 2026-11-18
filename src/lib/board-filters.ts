import { z } from "zod";

// The board filter state. Shared by the filter popover (client) and saved
// filters (stored as JSON, validated with the schema below on both ends).
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

// Missing fields fall back to "no filter", so filters saved by an older
// version keep working when a field is added later.
export const filtersSchema = z.object({
  query: z.string().max(200).default(""),
  assigneeId: z.string().max(64).default(""),
  tagId: z.string().max(64).default(""),
  priority: z.enum(["", "low", "normal", "high", "critical"]).default(""),
  deadline: z.enum(["", "overdue", "has", "none"]).default(""),
  mine: z.boolean().default(false),
}) satisfies z.ZodType<Filters, unknown>;

export function isFiltering(f: Filters): boolean {
  return f.query.trim() !== "" || !!f.assigneeId || !!f.tagId || !!f.priority || !!f.deadline || f.mine;
}

/** Parses stored JSON; null when it is not a valid filter. */
export function parseFilters(json: string): Filters | null {
  try {
    const result = filtersSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
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
