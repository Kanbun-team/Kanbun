// Client-safe helpers for card templates (JSON columns on CardTemplate).

export const TEMPLATE_CHECKLIST_MAX = 50;

/** A JSON array of strings; anything malformed becomes an empty list. */
export function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** One checklist item per non-empty line, trimmed and capped. */
export function checklistFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, TEMPLATE_CHECKLIST_MAX);
}
