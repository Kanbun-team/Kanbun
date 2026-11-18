// Small RFC 4180 CSV reader and writer. Handles quoted fields, doubled quotes
// inside quotes, line breaks inside quoted fields, CRLF or LF line endings, a
// leading byte order mark, and comma or semicolon delimiters (spreadsheets in
// many European locales save with semicolons). Client-safe.

export type Delimiter = "," | ";" | "\t";

/** Picks the delimiter that appears most often outside quotes on the first line. */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && (ch === "," || ch === ";" || ch === "\t")) counts[ch] += 1;
  }
  if (counts[";"] > counts[","] && counts[";"] >= counts["\t"]) return ";";
  if (counts["\t"] > counts[","]) return "\t";
  return ",";
}

/**
 * Parses CSV text into rows of fields. Blank lines are skipped. An unclosed
 * quote runs to the end of the input (the way spreadsheets read it).
 */
export function parseCsv(input: string, delimiter: Delimiter = detectDelimiter(stripBom(input))): string[][] {
  const text = stripBom(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endRow = () => {
    row.push(field);
    field = "";
    // A line with a single empty field is a blank line.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i += 1;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
      i += 1;
    } else if (ch === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
    } else if (ch === "\n") {
      endRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Quotes a field when it holds the delimiter, a quote or a line break. */
export function csvField(value: unknown, delimiter: Delimiter = ","): string {
  const s = value === null || value === undefined ? "" : String(value);
  // Leading =, +, -, @ would run as a formula in spreadsheets: prefix a quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return safe.includes(delimiter) || /["\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Undoes the formula guard added by `csvField`, so exported files import back unchanged. */
export function unguardField(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

/** Serializes rows to CSV with CRLF line endings (what spreadsheets expect). */
export function toCsv(rows: unknown[][], delimiter: Delimiter = ","): string {
  return rows.map((r) => r.map((v) => csvField(v, delimiter)).join(delimiter)).join("\r\n") + "\r\n";
}
