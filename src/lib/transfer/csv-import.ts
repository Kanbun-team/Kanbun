import { unguardField } from "@/lib/csv";
import { PRIORITIES, type Priority } from "@/lib/labels";

// CSV import into an existing board: header mapping, row validation and the
// preview. Pure and client-safe, so the preview in the browser and the import
// on the server run exactly the same checks.

export const CSV_FIELDS = ["title", "description", "column", "priority", "deadline", "tags", "assignees"] as const;
export type CsvField = (typeof CSV_FIELDS)[number];
/** Field -> index of the CSV column it is read from, or null when not imported. */
export type CsvMapping = Record<CsvField, number | null>;

export const MAX_CSV_ROWS = 5000;

// Header names recognized automatically (lowercase, compared without spaces,
// dashes and underscores). Includes the headers of Kanbun's own CSV export and
// the common translations.
const ALIASES: Record<CsvField, string[]> = {
  title: ["title", "name", "card", "cardname", "task", "summary", "titolo", "tytul", "tytuł", "titel", "nome", "nazwa"],
  description: ["description", "desc", "details", "notes", "body", "descrizione", "opis", "beschreibung"],
  column: ["column", "list", "status", "stage", "listname", "colonna", "kolumna", "spalte", "stato"],
  priority: ["priority", "priorita", "priorità", "priorytet", "prioritat", "priorität"],
  deadline: ["deadline", "due", "duedate", "dueon", "scadenza", "termin", "fällig", "fallig", "fälligkeit"],
  tags: ["tags", "tag", "labels", "label", "etichette", "tagi", "etykiety", "schlagwörter", "schlagworter"],
  assignees: ["assignees", "assignee", "members", "assignedto", "owner", "assegnatari", "przypisani", "zuständig", "zustandig"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_\-.]+/g, "");

/** Guesses which CSV column feeds each field from the header row. */
export function guessMapping(headers: string[]): CsvMapping {
  const mapping = Object.fromEntries(CSV_FIELDS.map((f) => [f, null])) as CsvMapping;
  const used = new Set<number>();
  for (const field of CSV_FIELDS) {
    const index = headers.findIndex((h, i) => !used.has(i) && ALIASES[field].includes(norm(h)));
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mapping;
}

export interface CsvBoardContext {
  columns: string[];
  tags: string[];
  /** Usernames that can be assigned on this board (its members). */
  members: string[];
}

export interface PlannedCard {
  /** 1-based line in the file (the header is line 1). */
  line: number;
  title: string;
  description: string | null;
  column: string;
  priority: Priority;
  deadline: string | null;
  tags: string[];
  assignees: string[];
}

export type CsvIssue =
  | { line: number; kind: "missingTitle" }
  | { line: number; kind: "badPriority"; value: string }
  | { line: number; kind: "badDeadline"; value: string }
  | { line: number; kind: "unknownUser"; value: string };

export interface CsvPlan {
  cards: PlannedCard[];
  /** Rows that are skipped. */
  errors: CsvIssue[];
  /** Rows that are imported with a value dropped or defaulted. */
  warnings: CsvIssue[];
  newColumns: string[];
  newTags: string[];
  tooManyRows: boolean;
}

const PRIORITY_WORDS: Record<string, Priority> = {
  low: "low", bassa: "low", niska: "low", niedrig: "low",
  normal: "normal", medium: "normal", normale: "normal", media: "normal", normalna: "normal", mittel: "normal", "": "normal",
  high: "high", alta: "high", wysoka: "high", hoch: "high",
  critical: "critical", urgent: "critical", critica: "critical", urgente: "critical", krytyczna: "critical", kritisch: "critical", dringend: "critical",
};

function parsePriority(value: string): Priority | null {
  const v = value.trim().toLowerCase();
  if ((PRIORITIES as readonly string[]).includes(v)) return v as Priority;
  return PRIORITY_WORDS[v] ?? null;
}

/** Accepts YYYY-MM-DD (optionally with a time), DD.MM.YYYY and DD/MM/YYYY. */
export function parseCsvDate(value: string): string | null {
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Splits a list cell ("design, urgent" or "design; urgent"). */
export function splitList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,;|\n]/)
        .map((s) => s.trim().replace(/^@/, ""))
        .filter(Boolean)
    )
  );
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/**
 * Validates the data rows (header row excluded) against the mapping. Values
 * matching existing columns and tags ignore case; anything new is created.
 */
export function planCsvImport(rows: string[][], mapping: CsvMapping, ctx: CsvBoardContext): CsvPlan {
  const columnByKey = new Map(ctx.columns.map((c) => [c.toLowerCase(), c]));
  const tagByKey = new Map(ctx.tags.map((t) => [t.toLowerCase(), t]));
  const members = new Set(ctx.members.map((m) => m.toLowerCase()));
  const newColumns: string[] = [];
  const newTags: string[] = [];
  const defaultColumn = ctx.columns[0] ?? "To do";
  const plan: CsvPlan = { cards: [], errors: [], warnings: [], newColumns, newTags, tooManyRows: rows.length > MAX_CSV_ROWS };

  const cell = (row: string[], field: CsvField) => {
    const index = mapping[field];
    return index === null || index === undefined ? "" : unguardField((row[index] ?? "").trim());
  };

  rows.slice(0, MAX_CSV_ROWS).forEach((row, i) => {
    const line = i + 2;
    const title = clip(cell(row, "title").replace(/\s+/g, " "), 200);
    if (!title) {
      plan.errors.push({ line, kind: "missingTitle" });
      return;
    }

    const rawPriority = cell(row, "priority");
    let priority = parsePriority(rawPriority);
    if (!priority) {
      plan.warnings.push({ line, kind: "badPriority", value: rawPriority });
      priority = "normal";
    }

    const rawDeadline = cell(row, "deadline");
    let deadline: string | null = null;
    if (rawDeadline) {
      deadline = parseCsvDate(rawDeadline);
      if (!deadline) plan.warnings.push({ line, kind: "badDeadline", value: rawDeadline });
    }

    let column = clip(cell(row, "column"), 80) || defaultColumn;
    const existingColumn = columnByKey.get(column.toLowerCase());
    if (existingColumn) column = existingColumn;
    else {
      columnByKey.set(column.toLowerCase(), column);
      newColumns.push(column);
    }

    const tags = splitList(cell(row, "tags")).map((raw) => {
      const name = clip(raw, 40);
      const existing = tagByKey.get(name.toLowerCase());
      if (existing) return existing;
      tagByKey.set(name.toLowerCase(), name);
      newTags.push(name);
      return name;
    });

    const assignees: string[] = [];
    for (const name of splitList(cell(row, "assignees"))) {
      const username = name.toLowerCase();
      if (members.has(username)) assignees.push(username);
      else plan.warnings.push({ line, kind: "unknownUser", value: name });
    }

    const description = cell(row, "description");
    plan.cards.push({
      line,
      title,
      description: description ? clip(description, 20_000) : null,
      column,
      priority,
      deadline,
      tags: Array.from(new Set(tags)),
      assignees,
    });
  });
  return plan;
}
