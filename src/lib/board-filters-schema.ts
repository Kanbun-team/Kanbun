import { z } from "zod";
import type { Filters } from "./board-filters";

// Validation for saved filters, used on the server. Kept apart from
// board-filters.ts so the board's client bundle does not include zod.

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

/** Parses stored JSON; null when it is not a valid filter. */
export function parseFilters(json: string): Filters | null {
  try {
    const result = filtersSchema.safeParse(JSON.parse(json));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
