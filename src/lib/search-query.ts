// Helpers for global search (src/server/search-actions.ts and the command
// palette). Pure functions, shared by server and client, unit tested.

/** Longest query we look at; anything past it is ignored. */
export const MAX_QUERY_LENGTH = 200;
const MAX_TERMS = 8;

/** Markers that FTS5 snippet() puts around matched terms. Control characters
 * cannot be typed into a card, so they never collide with user text. */
export const MARK_START = "\u0002";
export const MARK_END = "\u0003";

/** Splits user input into search terms: runs of letters and digits. Every
 * other character (quotes, operators, parentheses, stars) is a separator, so
 * nothing the user types can reach FTS5 query syntax. */
export function searchTerms(input: string): string[] {
  const words = input.slice(0, MAX_QUERY_LENGTH).match(/[\p{L}\p{N}]+/gu) ?? [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    terms.push(lower);
    if (terms.length === MAX_TERMS) break;
  }
  return terms;
}

/** Builds an FTS5 MATCH expression: every term quoted as a string and matched
 * as a prefix, all terms required. Returns null when there is nothing to
 * search for. The result is still passed as a bound parameter, never
 * concatenated into SQL. */
export function buildFtsQuery(input: string): string | null {
  const terms = searchTerms(input);
  if (terms.length === 0) return null;
  // Terms only contain letters and digits, but quote-doubling keeps this safe
  // even if the tokenizer above ever changes.
  return terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(" ");
}

/** Builds a PostgreSQL to_tsquery() expression with the same meaning as
 * buildFtsQuery: every term required, each matched as a prefix. Terms are
 * folded like the indexed text (no diacritics, ł as l) and quoted as tsquery
 * literals. Returns null when there is nothing to search for. Passed as a bound
 * parameter, never concatenated into SQL. */
export function buildTsQuery(input: string): string | null {
  const terms = searchTerms(input)
    .map((term) => foldText(term).replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter(Boolean);
  if (terms.length === 0) return null;
  return terms.map((term) => `'${term.replace(/'/g, "''")}':*`).join(" & ");
}

/** Lowercase, without diacritics (also ł, which has no Unicode decomposition),
 * for matching names on the client and for board names on the server. */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase();
}

/** True when every search term is a prefix of some word in `text`. */
export function matchesTerms(text: string, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const words = (foldText(text).match(/[\p{L}\p{N}]+/gu) ?? []);
  return terms.every((term) => {
    const folded = foldText(term);
    return words.some((word) => word.startsWith(folded));
  });
}

export interface SnippetPart {
  text: string;
  match: boolean;
}

/** Splits an FTS5 snippet with MARK_START/MARK_END markers into plain text
 * parts, so the UI can render highlights as elements instead of HTML. */
export function parseSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let match = false;
  let buffer = "";
  const flush = () => {
    if (buffer) parts.push({ text: buffer, match });
    buffer = "";
  };
  for (const ch of snippet) {
    if (ch === MARK_START) {
      flush();
      match = true;
    } else if (ch === MARK_END) {
      flush();
      match = false;
    } else {
      buffer += ch;
    }
  }
  flush();
  return parts;
}

/** Collapses whitespace (snippets can span lines of a description). */
export function squashWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
